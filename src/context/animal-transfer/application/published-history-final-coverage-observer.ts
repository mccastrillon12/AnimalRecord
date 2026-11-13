import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import {
  PublishedHistoryFinalCoverageInput,
  publishedHistoryFinalCoverageInput,
} from '../domain/published-history-final-coverage';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ITEM_MANIFEST_FILES_DIGEST_SEED,
  ITEM_MANIFEST_PAGE_SIZE,
  appendItemManifestFileDigest,
} from '../domain/transfer-item-manifest-digest';

const protocol = 'PUBLISHED_HISTORY_FINAL_COVERAGE_V1' as const;
const invalid = () =>
  new ConflictError(
    'The retained final versions do not cover the published predecessor manifest',
  );

/** Read-only traversal in predecessor file order. Every page uses its own snapshot. */
export class PublishedHistoryFinalCoverageObserver {
  constructor(
    private readonly store: Required<
      Pick<OwnershipArchiveHistoryRepository, 'readPublishedFinalCoveragePage'>
    >,
  ) {}

  async observe(raw: PublishedHistoryFinalCoverageInput) {
    const input = publishedHistoryFinalCoverageInput(raw);
    let afterSourceFileId: string | undefined;
    let pageBindingHash: string | undefined;
    let fileCount = 0;
    let filesDigest = ITEM_MANIFEST_FILES_DIGEST_SEED;
    let versionsDigest = archiveHash([protocol, 'FILES']);

    for (;;) {
      const page = await this.store.readPublishedFinalCoveragePage({
        ...input,
        afterSourceFileId,
      });
      const { rows, ...binding } = page;
      const currentBindingHash = archiveHash(binding);
      if (
        binding.archiveDefinitionHash !== input.expectedArchiveDefinitionHash ||
        binding.publicationHash !== input.expectedPublicationHash ||
        binding.sourceManifestHash !== input.expectedSourceManifestHash ||
        !isUuid(binding.sourceArchiveId) ||
        binding.sourceArchiveId === input.archiveId ||
        ![binding.reservationBindingHash, binding.sourceFilesDigest].every(
          sourceHashValid,
        ) ||
        (pageBindingHash !== undefined &&
          pageBindingHash !== currentBindingHash) ||
        !Number.isSafeInteger(binding.sourceFileCount) ||
        !Array.isArray(page.rows) ||
        rows.length > ITEM_MANIFEST_PAGE_SIZE ||
        fileCount + rows.length > binding.sourceFileCount
      )
        throw invalid();
      pageBindingHash = currentBindingHash;

      if (!rows.length) {
        if (
          fileCount !== binding.sourceFileCount ||
          filesDigest !== binding.sourceFilesDigest
        )
          throw invalid();
        const facts = {
          protocol,
          archiveId: input.archiveId,
          reservationEpoch: input.expectedReservationEpoch,
          ...binding,
          fileCount,
          filesDigest,
          versionsDigest,
          requiredThrough: input.requiredThrough,
          coverage: 'ALL_RETAINED_FILES_OBSERVED' as const,
          reservation: 'OBSERVED_ONLY' as const,
          stableCut: 'NOT_ASSESSED' as const,
          retention: 'NOT_ASSESSED' as const,
          copyDispatch: 'NOT_AUTHORIZED' as const,
          businessCommit: 'NOT_AUTHORIZED' as const,
        };
        return Object.freeze({ ...facts, observationHash: archiveHash(facts) });
      }

      for (const row of rows) {
        if (
          !row ||
          Object.keys(row).sort().join(',') !==
            'attemptDefinitionHash,conservationControlsHash,fileDefinitionHash,fileId,intentDefinitionHash,permissionHash,sourceDefinitionHash,sourceFileId,versionObservationHash' ||
          !Object.values(row).every(sourceHashValid) ||
          (afterSourceFileId !== undefined &&
            row.sourceFileId <= afterSourceFileId)
        )
          throw invalid();
        filesDigest = appendItemManifestFileDigest(
          filesDigest,
          row.sourceFileId,
          row.sourceDefinitionHash,
        );
        versionsDigest = archiveHash({ previous: versionsDigest, row });
        afterSourceFileId = row.sourceFileId;
        fileCount++;
      }
    }
  }
}
