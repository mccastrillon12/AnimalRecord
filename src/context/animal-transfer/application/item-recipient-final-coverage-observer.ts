import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL,
  ItemRecipientFinalMediaRegistration,
} from '../domain/ownership-archive-media-registration';
import type { ItemCopyRecordStore } from '../domain/transfer-item-copy-record';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ITEM_MANIFEST_FILES_DIGEST_SEED,
  ITEM_MANIFEST_PAGE_SIZE,
  appendItemManifestFileDigest,
  captureItemManifestDigest,
} from '../domain/transfer-item-manifest-digest';
import {
  ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
  ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL,
  ItemRecipientFinalCoverageFile,
  ItemRecipientFinalCoverageInput,
  ItemRecipientFinalCoverageObservation,
  ItemRecipientFinalCoveragePage,
  ItemRecipientPreparedCoverageObservation,
  ItemRecipientProjectionMedia,
  ItemRecipientProjectionMediaPage,
  recipientFinalCoverageInput,
} from '../domain/transfer-item-recipient-final-coverage';

const invalid = () =>
  new ConflictError(
    'The final versions do not cover the original item manifest',
  );

/** Read-only traversal of evidence already recorded under the original reservation. */
export class ItemRecipientFinalCoverageObserver {
  constructor(
    private readonly store: Partial<
      Pick<
        ItemCopyRecordStore,
        | 'readRecipientFinalCoveragePage'
        | 'readRecipientPreparedCoveragePage'
        | 'readRecipientProjectionMediaPage'
      >
    >,
  ) {}

  observe(raw: ItemRecipientFinalCoverageInput) {
    return this.observeCoverage(raw, 'VERSIONS');
  }

  observePrepared(raw: ItemRecipientFinalCoverageInput) {
    return this.observeCoverage(raw, 'PREPARED');
  }

  observeProjectionMedia(raw: ItemRecipientFinalCoverageInput) {
    return this.observeCoverage(raw, 'PROJECTION');
  }

  private observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    mode: 'VERSIONS',
  ): Promise<ItemRecipientFinalCoverageObservation>;
  private observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    mode: 'PREPARED',
  ): Promise<ItemRecipientPreparedCoverageObservation>;
  private observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    mode: 'PROJECTION',
  ): Promise<ItemRecipientProjectionMedia>;
  private async observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    mode: 'VERSIONS' | 'PREPARED' | 'PROJECTION',
  ): Promise<
    | ItemRecipientFinalCoverageObservation
    | ItemRecipientPreparedCoverageObservation
    | ItemRecipientProjectionMedia
  > {
    const input = recipientFinalCoverageInput(raw);
    const prepared = mode !== 'VERSIONS';
    const readPage = {
      VERSIONS: this.store.readRecipientFinalCoveragePage,
      PREPARED: this.store.readRecipientPreparedCoveragePage,
      PROJECTION: this.store.readRecipientProjectionMediaPage,
    }[mode];
    if (!readPage)
      throw new ConflictError(
        'A reader for this media coverage must be configured',
      );
    let afterId: string | undefined;
    let fileCount = 0;
    let filesDigest = ITEM_MANIFEST_FILES_DIGEST_SEED;
    let versionsDigest = archiveHash([
      ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
      'FILES',
    ]);
    let registrationsDigest = archiveHash([
      ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL,
      'FILES',
    ]);
    const media: ItemRecipientFinalMediaRegistration[] = [];

    for (;;) {
      const page: ItemRecipientFinalCoveragePage &
        Partial<Pick<ItemRecipientProjectionMediaPage, 'media'>> =
        await readPage.call(this.store, { ...input, afterId });
      const { rows, media: pageMedia } = page;
      const manifest = captureItemManifestDigest(page.manifest);
      const { binding } = manifest;
      if (
        manifest.manifestHash !== input.expectedManifestHash ||
        binding.observedSealHash !== input.expectedSealHash ||
        binding.transferId !== input.selector.transferId ||
        binding.itemId !== input.selector.itemId ||
        binding.requestVersion !== input.selector.expectedRequestVersion ||
        !Array.isArray(page.rows) ||
        (mode === 'PROJECTION' &&
          (!Array.isArray(page.media) || pageMedia?.length !== rows.length)) ||
        rows.length > ITEM_MANIFEST_PAGE_SIZE ||
        fileCount + rows.length > manifest.fileCount
      )
        throw invalid();

      if (!rows.length) {
        if (
          fileCount !== manifest.fileCount ||
          filesDigest !== manifest.filesDigest
        )
          throw invalid();
        const evidence = {
          binding,
          manifestHash: manifest.manifestHash,
          fileCount,
          filesDigest,
          versionsDigest,
          requiredThrough: input.requiredThrough,
          reservation: 'OBSERVED_ONLY' as const,
          stableCut: 'NOT_ASSESSED' as const,
          retention: 'NOT_ASSESSED' as const,
          copyDispatch: 'NOT_AUTHORIZED' as const,
          businessCommit: 'NOT_AUTHORIZED' as const,
        };
        if (!prepared) {
          const observation = {
            ...evidence,
            protocol: ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
            coverage: 'ALL_MANIFEST_FILES_OBSERVED' as const,
          };
          return Object.freeze({
            ...observation,
            observationHash: archiveHash(observation),
          });
        }
        const observation = {
          ...evidence,
          protocol: ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL,
          coverage: 'ALL_MANIFEST_FILES_PREPARED' as const,
          registrationsDigest,
        };
        const coverage = Object.freeze({
          ...observation,
          observationHash: archiveHash(observation),
        });
        return mode === 'PROJECTION'
          ? Object.freeze({ manifest, coverage, media: Object.freeze(media) })
          : coverage;
      }

      for (const [index, row] of rows.entries()) {
        if (!row) throw invalid();
        const proof: ItemRecipientFinalCoverageFile & {
          registrationDefinitionHash?: string;
        } = row;
        const { registrationDefinitionHash, ...version } = proof;
        if (
          prepared !== 'registrationDefinitionHash' in proof ||
          (prepared && !sourceHashValid(registrationDefinitionHash)) ||
          Object.keys(version).sort().join(',') !==
            'attemptDefinitionHash,conservationControlsHash,fileDefinitionHash,fileId,intentDefinitionHash,permissionHash,versionObservationHash' ||
          !Object.values(version).every(sourceHashValid) ||
          (afterId !== undefined && version.fileId <= afterId)
        )
          throw invalid();
        filesDigest = appendItemManifestFileDigest(
          filesDigest,
          version.fileId,
          version.fileDefinitionHash,
        );
        versionsDigest = archiveHash({
          previous: versionsDigest,
          row: version,
        });
        if (prepared)
          registrationsDigest = archiveHash({
            previous: registrationsDigest,
            fileId: version.fileId,
            registrationDefinitionHash,
          });
        if (mode === 'PROJECTION') {
          const registration = pageMedia?.[index];
          if (
            registration?.protocol !==
              ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL ||
            registration.fileId !== version.fileId ||
            registration.definitionHash !== registrationDefinitionHash
          )
            throw invalid();
          const { definitionHash, ...facts } = registration;
          if (archiveHash(facts) !== definitionHash) throw invalid();
          media.push(structuredClone(registration));
        }
        afterId = version.fileId;
        fileCount++;
      }
    }
  }
}
