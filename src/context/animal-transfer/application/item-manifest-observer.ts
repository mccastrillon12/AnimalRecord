import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { DomainError } from '../../shared/domain/DomainError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import { archiveHash } from '../domain/ownership-archive';
import {
  buildItemHistoricalSourceAnchor,
  historicalSourceAnchorInput,
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalSourceAnchorInput,
  ItemHistoricalSourceAnchorMaterial,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import {
  ItemFixedSourceMetadata,
  ItemFixedSourceReader,
  ItemFixedSourceStorage,
  ItemSourceProfileObservationInput,
  ItemSourceProfileObservationSet,
  ItemSourceProfileReader,
  ItemSourceProfileRecord,
  ItemSourceProfileReference,
  ItemSourceRetentionReader,
  assertItemSourceProfileWindow,
  buildItemFixedSourceObservation,
  buildItemSourceProfileObservation,
  buildItemSourceRetentionObservation,
  buildItemSourceStorageObservation,
  itemSourceProfileObservationInput,
  matchActiveItemSourceProfile,
  sourceRetentionSelectorHash,
} from '../domain/transfer-item-historical-observation';
import {
  ItemManifestDigest,
  ItemManifestDigestInput,
  ItemManifestCursor,
  itemManifestDigestInput,
  ITEM_MANIFEST_PAGE_SIZE,
} from '../domain/transfer-item-manifest-digest';
import {
  ItemSourceArtifactDraft,
  ItemSourceArtifactReader,
  ItemSourceArtifactSeal,
  OpenItemSourceArtifact,
  buildItemSourceArtifactSeal,
  captureItemSourceArtifactIdentity,
  captureItemSourceArtifactSeal,
} from '../domain/transfer-item-source-artifact';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

/** Explicit internal composition only; read-only, no worker, provider or HTTP DTO. */
export class ItemManifestObserver {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      'readManifestPage' | 'readHistoricalSourceForAnchor'
    >,
    private readonly keyFromUrl: (url: string) => string | undefined,
    private readonly sourceRetention?: Readonly<{
      reader: ItemSourceRetentionReader | ItemFixedSourceReader;
      now: () => Date;
      profiles?: ItemSourceProfileReader;
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
    if (
      !this.sourceRetention ||
      !('readSourceRetention' in this.sourceRetention.reader)
    )
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
    if (!Number.isFinite(observedAt))
      throw new ConflictError(
        'The source compliance retention observation is invalid or expired',
      );
    const observation = buildItemSourceRetentionObservation({
      anchorHash: anchor.anchorHash,
      selectorHash: sourceRetentionSelectorHash(
        material.source,
        expectedBucketOwner,
      ),
      mode,
      observedAt: new Date(observedAt).toISOString(),
      reportedRetainUntil,
    });

    const current = await this.store.readHistoricalSourceForAnchor(input);
    if (archiveHash(current) !== materialHash)
      throw new ConflictError(
        'The historical source anchor changed during retention observation',
      );
    const checkedAt = now().getTime();
    if (
      !Number.isFinite(checkedAt) ||
      checkedAt < observedAt ||
      checkedAt >= Date.parse(observation.reportedRetainUntil)
    )
      throw new ConflictError(
        'The source compliance retention observation is invalid or expired',
      );

    return observation;
  }
  async observeHistoricalFixedSource(raw: ItemHistoricalSourceAnchorInput) {
    return (await this.readHistoricalFixedSource(raw)).fixedSource;
  }
  async observeHistoricalSourceStorage(raw: ItemHistoricalSourceAnchorInput) {
    const { fixedSource, storage } = await this.readHistoricalFixedSource(raw);
    return this.sourceStorageResult(fixedSource, storage);
  }
  async observeHistoricalSourceProfile(
    raw: ItemSourceProfileObservationInput,
  ): Promise<ItemSourceProfileObservationSet> {
    const input = itemSourceProfileObservationInput(raw);
    return (await this.readHistoricalSourceProfile(input)).observation;
  }

  async sealHistoricalSourceArtifact(
    raw: ItemSourceProfileObservationInput,
    draft: ItemSourceArtifactDraft,
  ): Promise<ItemSourceArtifactSeal> {
    let sealStarted = false;
    try {
      const input = itemSourceProfileObservationInput(raw);
      const identity = captureItemSourceArtifactIdentity(draft.identity);
      const { observation, expectedBucketOwner, size, sha256 } =
        await this.readHistoricalSourceProfile(input, (bytes) =>
          draft.write(bytes),
        );
      const { fixedSource, profileObservation } = observation;
      const seal = buildItemSourceArtifactSeal({
        ...identity,
        anchorHash: fixedSource.anchorHash,
        selectorHash: fixedSource.selectorHash,
        profileDefinitionHash: input.expectedProfile.definitionHash,
        profileObservationHash: profileObservation.observationHash,
        expectedBucketOwner,
        observedAt: fixedSource.observedAt,
        fixedRetainUntil: fixedSource.fixedRetainUntil,
        size,
        sha256,
      });
      sealStarted = true;
      await draft.seal(seal);
      await this.recheckArtifactSource(input, seal);
      return seal;
    } catch (error) {
      if (!sealStarted) {
        try {
          await draft.discard();
        } catch {
          // A cleanup failure must not hide the primary failure.
        }
      }
      throw error;
    }
  }

  async openHistoricalSourceArtifact(
    raw: ItemSourceProfileObservationInput,
    expected: ItemSourceArtifactSeal,
    reader: ItemSourceArtifactReader,
  ): Promise<OpenItemSourceArtifact> {
    const input = itemSourceProfileObservationInput(raw);
    const seal = captureItemSourceArtifactSeal(expected);
    const profile = await this.readActiveSourceProfile(input.expectedProfile);
    const { material } = await this.readAnchoredHistoricalSource(input.anchor);
    this.assertArtifactSource(material, profile, seal);
    const opened = await reader.open(captureItemSourceArtifactIdentity(seal));
    if (!opened)
      throw new ConflictError('The sealed source artifact is unavailable');
    const close = opened.close.bind(opened);
    try {
      const { body } = opened;
      if (
        captureItemSourceArtifactSeal(opened.seal).artifactHash !==
          seal.artifactHash ||
        typeof body?.[Symbol.asyncIterator] !== 'function'
      )
        throw new ConflictError(
          'The opened source artifact does not match the expected seal',
        );
      await this.recheckArtifactSource(input, seal);
      return Object.freeze({ seal, body, close });
    } catch (error) {
      try {
        close();
      } catch {
        // Keep the seal or source conflict when closing the rejected handle fails.
      }
      throw error;
    }
  }

  private async recheckArtifactSource(
    input: ItemSourceProfileObservationInput,
    seal: ItemSourceArtifactSeal,
  ) {
    const profile = await this.readActiveSourceProfile(input.expectedProfile);
    const current = await this.store.readHistoricalSourceForAnchor(
      input.anchor,
    );
    this.assertArtifactSource(current, profile, seal);
  }

  private assertArtifactSource(
    material: ItemHistoricalSourceAnchorMaterial,
    profile: ItemSourceProfileRecord,
    seal: ItemSourceArtifactSeal,
  ) {
    if (
      seal.anchorHash !==
        buildItemHistoricalSourceAnchor(material).anchorHash ||
      seal.selectorHash !==
        sourceRetentionSelectorHash(
          material.source,
          seal.expectedBucketOwner,
        ) ||
      seal.profileDefinitionHash !== profile.definitionHash ||
      seal.size !== material.source.revision.size ||
      seal.sha256 !== material.source.sha256
    )
      throw new ConflictError(
        'The sealed source artifact does not match the original source',
      );
    const checkedAt = this.sourceRetention?.now().getTime() ?? NaN;
    if (
      profile.selectorHash !== seal.selectorHash ||
      !(
        Date.parse(seal.observedAt) <= checkedAt &&
        checkedAt < Date.parse(seal.fixedRetainUntil)
      )
    )
      throw new ConflictError(
        'The sealed source artifact is outside its source window',
      );
    assertItemSourceProfileWindow(profile, checkedAt);
  }

  private async readHistoricalSourceProfile(
    { anchor, expectedProfile }: ItemSourceProfileObservationInput,
    writeCandidate?: (bytes: Uint8Array) => Promise<void>,
  ) {
    const { fixedSource, storage, expectedBucketOwner, size, sha256 } =
      await this.readHistoricalFixedSource(
        anchor,
        expectedProfile,
        writeCandidate,
      );
    const result = this.sourceStorageResult(fixedSource, storage);
    const observation = Object.freeze({
      ...result,
      profileObservation: buildItemSourceProfileObservation(
        expectedProfile,
        fixedSource,
        result.storageObservation,
      ),
    });
    return { observation, expectedBucketOwner, size, sha256 };
  }
  private sourceStorageResult(
    fixedSource: ReturnType<typeof buildItemFixedSourceObservation>,
    storage: ItemFixedSourceStorage | undefined,
  ) {
    if (!storage)
      throw new ConflictError(
        'The fixed source storage metadata was not captured',
      );
    return Object.freeze({
      fixedSource,
      storageObservation: buildItemSourceStorageObservation(
        fixedSource.observationHash,
        storage,
      ),
    });
  }
  private async readHistoricalFixedSource(
    raw: ItemHistoricalSourceAnchorInput,
    expectedProfile?: ItemSourceProfileReference,
    writeCandidate?: (bytes: Uint8Array) => Promise<void>,
  ) {
    const input = historicalSourceAnchorInput(raw);
    if (
      !this.sourceRetention ||
      !('readFixedSource' in this.sourceRetention.reader)
    )
      throw new ConflictError(
        'A fixed source reader must be configured explicitly',
      );
    const { reader, now } = this.sourceRetention;
    const profile = expectedProfile
      ? await this.readActiveSourceProfile(expectedProfile)
      : undefined;
    const { anchor, material } = await this.readAnchoredHistoricalSource(input);
    const { bucket, key, revision, sha256 } = material.source;
    if (!isPinnedItemSourceVersion(revision.versionId))
      throw new ConflictError(
        'A fixed source read requires the original explicit object version',
      );
    const target = Object.freeze({ bucket, key });
    const fixed = Object.freeze({ ...revision });
    const materialHash = archiveHash(material);
    const fail = () =>
      new ConflictError(
        'Fixed source observation does not match the original version',
      );

    let evidence: ItemFixedSourceMetadata;
    let storage: ItemFixedSourceStorage | undefined;
    if (profile) assertItemSourceProfileWindow(profile, now().getTime());
    try {
      const read = await reader.readFixedSource(target, fixed);
      const {
        expectedBucketOwner,
        mode,
        eventHold,
        fixedRetainUntil,
        storage: reportedStorage,
      } = read;
      evidence = { expectedBucketOwner, mode, eventHold, fixedRetainUntil };
      storage = reportedStorage && { ...reportedStorage };
      await verifyHistoricalObjectBytes(
        read,
        fixed,
        sha256,
        fail,
        writeCandidate,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'Fixed source bytes could not be observed',
      );
    }
    const observedAt = now().getTime();
    if (!Number.isFinite(observedAt)) throw fail();
    const observation = buildItemFixedSourceObservation({
      anchorHash: anchor.anchorHash,
      selectorHash: sourceRetentionSelectorHash(
        { bucket, key, revision: fixed, sha256 },
        evidence.expectedBucketOwner,
      ),
      mode: evidence.mode,
      eventHold: evidence.eventHold,
      fixedRetainUntil: evidence.fixedRetainUntil,
      observedAt: new Date(observedAt).toISOString(),
    });
    if (profile) {
      if (profile.selectorHash !== observation.selectorHash)
        throw new ConflictError(
          'The source profile does not cover the original version',
        );
      assertItemSourceProfileWindow(profile, observedAt);
      await this.readActiveSourceProfile(profile);
    }
    const current = await this.store.readHistoricalSourceForAnchor(input);
    if (archiveHash(current) !== materialHash) throw fail();
    const checkedAt = now().getTime();
    if (
      !Number.isFinite(checkedAt) ||
      checkedAt < observedAt ||
      checkedAt >= Date.parse(observation.fixedRetainUntil)
    )
      throw new ConflictError(
        'The fixed source retention date is invalid or expired',
      );
    if (profile) assertItemSourceProfileWindow(profile, checkedAt);
    return {
      fixedSource: observation,
      storage,
      expectedBucketOwner: evidence.expectedBucketOwner,
      size: fixed.size,
      sha256,
    };
  }
  private async readActiveSourceProfile(expected: ItemSourceProfileReference) {
    const profiles = this.sourceRetention?.profiles;
    if (!profiles)
      throw new ConflictError(
        'A current source profile reader must be configured explicitly',
      );
    let current: ItemSourceProfileRecord | null;
    try {
      current = await profiles.readCurrentSourceProfile(expected.id);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'The current source profile could not be read',
      );
    }
    return matchActiveItemSourceProfile(current, expected);
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
    return {
      anchor: buildItemHistoricalSourceAnchor({ ...source, binding }),
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
