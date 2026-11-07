import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import { archiveHash } from '../domain/ownership-archive';
import {
  historicalSourceAnchorInput,
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalSourceAnchorInput,
} from '../domain/transfer-item-copy-intent';
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
  ) {}
  async observe(raw: ItemManifestDigestInput) {
    const { digest } = await this.traverse(itemManifestDigestInput(raw));
    return digest;
  }
  async anchorHistoricalSource(raw: ItemHistoricalSourceAnchorInput) {
    const input = historicalSourceAnchorInput(raw);
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
    return Object.freeze({
      ...definition,
      anchorHash: archiveHash(definition),
    });
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
