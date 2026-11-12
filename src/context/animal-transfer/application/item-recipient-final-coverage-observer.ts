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
  ItemRecipientFinalCoverageInput,
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
    >,
  ) {}

  async observe(raw: ItemRecipientFinalCoverageInput) {
    const input = recipientFinalCoverageInput(raw);
    let afterId: string | undefined;
    let fileCount = 0;
    let filesDigest = ITEM_MANIFEST_FILES_DIGEST_SEED;
    let versionsDigest = archiveHash([
      ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
      'FILES',
    ]);

    for (;;) {
      const page = await this.store.readRecipientFinalCoveragePage({
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
          protocol: ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL,
          binding,
          manifestHash: manifest.manifestHash,
          fileCount,
          filesDigest,
          versionsDigest,
          requiredThrough: input.requiredThrough,
          coverage: 'ALL_MANIFEST_FILES_OBSERVED' as const,
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
        if (
          !row ||
          Object.keys(row).sort().join(',') !==
            'attemptDefinitionHash,conservationControlsHash,fileDefinitionHash,fileId,intentDefinitionHash,permissionHash,versionObservationHash' ||
          !Object.values(row).every(sourceHashValid) ||
          (afterId !== undefined && row.fileId <= afterId)
        )
          throw invalid();
        filesDigest = appendItemManifestFileDigest(
          filesDigest,
          row.fileId,
          row.fileDefinitionHash,
        );
        versionsDigest = archiveHash({ previous: versionsDigest, row });
        afterId = row.fileId;
        fileCount++;
      }
    }
  }
}
