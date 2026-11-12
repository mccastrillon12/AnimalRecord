import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
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
  ItemRecipientPreparedCoverageObservation,
  recipientFinalCoverageInput,
} from '../domain/transfer-item-recipient-final-coverage';

const invalid = () =>
  new ConflictError(
    'The final versions do not cover the original item manifest',
  );

/** Read-only traversal of evidence already recorded under the original reservation. */
export class ItemRecipientFinalCoverageObserver {
  constructor(
    private readonly store: Pick<
      ItemCopyRecordStore,
      'readRecipientFinalCoveragePage'
    > &
      Partial<Pick<ItemCopyRecordStore, 'readRecipientPreparedCoveragePage'>>,
  ) {}

  observe(raw: ItemRecipientFinalCoverageInput) {
    return this.observeCoverage(raw, false);
  }

  observePrepared(raw: ItemRecipientFinalCoverageInput) {
    return this.observeCoverage(raw, true);
  }

  private observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    prepared: false,
  ): Promise<ItemRecipientFinalCoverageObservation>;
  private observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    prepared: true,
  ): Promise<ItemRecipientPreparedCoverageObservation>;
  private async observeCoverage(
    raw: ItemRecipientFinalCoverageInput,
    prepared: boolean,
  ): Promise<
    | ItemRecipientFinalCoverageObservation
    | ItemRecipientPreparedCoverageObservation
  > {
    const input = recipientFinalCoverageInput(raw);
    const readPage = prepared
      ? this.store.readRecipientPreparedCoveragePage?.bind(this.store)
      : this.store.readRecipientFinalCoveragePage.bind(this.store);
    if (!readPage)
      throw new ConflictError(
        'A prepared media coverage reader must be configured',
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

    for (;;) {
      const page = await readPage({
        ...input,
        afterId,
      });
      const { rows } = page;
      const manifest = captureItemManifestDigest(page.manifest);
      const { binding } = manifest;
      if (
        manifest.manifestHash !== input.expectedManifestHash ||
        binding.observedSealHash !== input.expectedSealHash ||
        binding.transferId !== input.selector.transferId ||
        binding.itemId !== input.selector.itemId ||
        binding.requestVersion !== input.selector.expectedRequestVersion ||
        !Array.isArray(page.rows) ||
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
        const observation = {
          ...(prepared
            ? {
                protocol: ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL,
                coverage: 'ALL_MANIFEST_FILES_PREPARED' as const,
                registrationsDigest,
              }
            : {
                protocol: ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
                coverage: 'ALL_MANIFEST_FILES_OBSERVED' as const,
              }),
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
        return Object.freeze({
          ...observation,
          observationHash: archiveHash(observation),
        });
      }

      for (const row of rows) {
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
        afterId = version.fileId;
        fileCount++;
      }
    }
  }
}
