import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import { archiveHash } from '../domain/ownership-archive';
import {
  historicalSourceAnchorInput,
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalSourceAnchorInput,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import { ItemSourceRetentionReader } from '../domain/transfer-item-historical-observation';
import {
  ItemManifestDigest,
  ItemManifestDigestInput,
  ItemManifestCursor,
  itemManifestDigestInput,
  ITEM_MANIFEST_PAGE_SIZE,
} from '../domain/transfer-item-manifest-digest';

/** Explicit internal composition only; read-only, no worker, provider or HTTP DTO. */
export class ItemManifestObserver {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      'readManifestPage' | 'readHistoricalSourceForAnchor'
    >,
    private readonly keyFromUrl: (url: string) => string | undefined,
    private readonly sourceRetention?: Readonly<{
      reader: ItemSourceRetentionReader;
      now: () => Date;
    }>,
  ) {}
  async observe(raw: ItemManifestDigestInput) {
    const { digest } = await this.traverse(itemManifestDigestInput(raw));
    return digest;
  }
  async anchorHistoricalSource(raw: ItemHistoricalSourceAnchorInput) {
    const { anchor } = await this.readAnchoredHistoricalSource(
      historicalSourceAnchorInput(raw),
    );
    return anchor;
  }
  async observeHistoricalSourceRetention(raw: ItemHistoricalSourceAnchorInput) {
    const input = historicalSourceAnchorInput(raw);
    if (!this.sourceRetention)
      throw new ConflictError(
        'A source retention reader must be configured explicitly',
      );
    const { reader, now } = this.sourceRetention;
    const { anchor, material } = await this.readAnchoredHistoricalSource(input);
    const {
      bucket,
      key,
      revision: { versionId },
    } = material.source;
    if (!isPinnedItemSourceVersion(versionId))
      throw new ConflictError(
        'Source retention requires the original explicit object version',
      );
    const target = Object.freeze({ bucket, key, versionId });
    const materialHash = archiveHash(material);
    // No local session is held across the provider call.
    const { expectedBucketOwner, mode, reportedRetainUntil } =
      await reader.readSourceRetention(target);
    const observedAt = now().getTime();
    const until =
      typeof reportedRetainUntil === 'string'
        ? Date.parse(reportedRetainUntil)
        : NaN;
    if (
      mode !== 'COMPLIANCE' ||
      typeof expectedBucketOwner !== 'string' ||
      expectedBucketOwner.length !== 12 ||
      !/^[0-9]{12}$/.test(expectedBucketOwner) ||
      !Number.isFinite(observedAt) ||
      !Number.isFinite(until) ||
      new Date(until).toISOString() !== reportedRetainUntil ||
      until <= observedAt
    )
      throw new ConflictError(
        'The source compliance retention observation is invalid or expired',
      );

    const current = await this.store.readHistoricalSourceForAnchor(input);
    if (archiveHash(current) !== materialHash)
      throw new ConflictError(
        'The historical source anchor changed during retention observation',
      );
    const checkedAt = now().getTime();
    if (
      !Number.isFinite(checkedAt) ||
      checkedAt < observedAt ||
      checkedAt >= until
    )
      throw new ConflictError(
        'The source compliance retention observation is invalid or expired',
      );

    const definition = {
      protocol: 'ITEM_HISTORICAL_SOURCE_RETENTION_OBSERVATION_V1' as const,
      anchorHash: anchor.anchorHash,
      selectorHash: archiveHash({ ...target, expectedBucketOwner }),
      mode,
      observedAt: new Date(observedAt).toISOString(),
      reportedRetainUntil,
      reservation: 'OBSERVED_ONLY' as const,
      provenance: 'NOT_ASSESSED' as const,
      readability: 'NOT_ASSESSED' as const,
      coverage: 'NOT_ASSESSED' as const,
      stableCut: 'NOT_ASSESSED' as const,
      retention: 'NOT_ASSESSED' as const,
      copyDispatch: 'NOT_AUTHORIZED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    };
    return Object.freeze({
      ...definition,
      observationHash: archiveHash(definition),
    });
  }
  private async readAnchoredHistoricalSource(
    input: ItemHistoricalSourceAnchorInput,
  ) {
    const { selector, expectedSealHash, fileId, expectedFileDefinitionHash } =
      input.preparation;
    const { digest, containsFile } = await this.traverse(
      { selector, expectedSealHash },
      input.preparation,
    );
    if (!containsFile || digest.manifestHash !== input.expectedManifestHash)
      throw new ConflictError(
        'The historical source is not anchored to the expected manifest traversal',
      );

    const source = await this.store.readHistoricalSourceForAnchor(input);
    const binding = Object.freeze({
      ...digest.binding,
      fileId,
      fileDefinitionHash: expectedFileDefinitionHash,
    });
    if (
      source.manifestHash !== digest.manifestHash ||
      archiveHash(source.binding) !== archiveHash(binding)
    )
      throw new ConflictError('The historical source anchor binding changed');
    const definition = {
      protocol: 'ITEM_HISTORICAL_SOURCE_ANCHOR_V1' as const,
      binding,
      manifestHash: source.manifestHash,
      intentId: source.intentId,
      intentDefinitionHash: source.intentDefinitionHash,
      sourceObservationHash: source.sourceObservationHash,
      reservation: 'OBSERVED_ONLY' as const,
      provenance: 'NOT_ASSESSED' as const,
      coverage: 'NOT_ASSESSED' as const,
      stableCut: 'NOT_ASSESSED' as const,
      retention: 'NOT_ASSESSED' as const,
      copyDispatch: 'NOT_AUTHORIZED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    };
    return {
      anchor: Object.freeze({
        ...definition,
        anchorHash: archiveHash(definition),
      }),
      material: source,
    };
  }
  private async traverse(
    input: ItemManifestDigestInput,
    target?: ItemHistoricalCopyPreparationInput,
  ) {
    let digest: ItemManifestDigest | undefined;
    let containsFile = false;
    let cursor: ItemManifestCursor = Object.freeze({
      phase: 'ENTRIES',
      limit: ITEM_MANIFEST_PAGE_SIZE,
    });
    for (;;) {
      const page = await this.store.readManifestPage({ ...input, cursor });
      if (!page || page.phase !== cursor.phase)
        throw new ConflictError(
          'Item manifest reader returned another traversal phase',
        );
      digest ??= new ItemManifestDigest(input, page.snapshot, this.keyFromUrl);
      if (page.phase === 'ENTRIES')
        digest.appendEntries(page.snapshot, page.rows);
      else if (page.phase === 'FILES') {
        digest.appendFiles(page.snapshot, page.rows);
        if (target && !containsFile)
          containsFile = page.rows.some(
            (file) =>
              file.id === target.fileId &&
              file.definitionHash === target.expectedFileDefinitionHash,
          );
      } else return { digest: digest.finish(page.snapshot), containsFile };
      cursor = digest.nextPage;
    }
  }
}
