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
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
  ITEM_MANIFEST_PAGE_SIZE,
  appendItemManifestEntryDigest,
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
    > &
      Pick<
        OwnershipArchiveHistoryRepository,
        'readPublishedPreparedCoveragePage' | 'readPublishedRetainedEntryPage'
      >,
  ) {}

  observe(raw: PublishedHistoryFinalCoverageInput) {
    return this.observeFiles(raw, false);
  }

  async observePrepared(raw: PublishedHistoryFinalCoverageInput) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const { observationHash: filesObservationHash, ...files } =
      await this.observeFiles(input, true);
    const readEntries = this.store.readPublishedRetainedEntryPage;
    if (!readEntries || !files.registrationsDigest) throw invalid();
    let afterSourceEntryId: string | undefined;
    let sourceBindingHash: string | undefined;
    let entryCount = 0;
    let entriesDigest = ITEM_MANIFEST_ENTRIES_DIGEST_SEED;
    let retainedEntriesDigest = archiveHash([
      'PUBLISHED_HISTORY_PREPARED_COVERAGE_V1',
      'ENTRIES',
    ]);
    for (;;) {
      const page = await readEntries.call(this.store, {
        ...input,
        afterSourceEntryId,
      });
      const { rows, ...binding } = page;
      const currentBindingHash = archiveHash(binding);
      if (
        binding.sourceArchiveId !== files.sourceArchiveId ||
        binding.reservationBindingHash !== files.reservationBindingHash ||
        !sourceHashValid(binding.sourceEntriesDigest) ||
        (sourceBindingHash !== undefined &&
          sourceBindingHash !== currentBindingHash) ||
        !Number.isSafeInteger(binding.sourceEntryCount) ||
        binding.sourceEntryCount < 1 ||
        !Array.isArray(page.rows) ||
        rows.length > ITEM_MANIFEST_PAGE_SIZE ||
        entryCount + rows.length > binding.sourceEntryCount
      )
        throw invalid();
      sourceBindingHash = currentBindingHash;
      if (!rows.length) {
        if (
          entryCount !== binding.sourceEntryCount ||
          entriesDigest !== binding.sourceEntriesDigest
        )
          throw invalid();
        const facts = {
          ...files,
          protocol: 'PUBLISHED_HISTORY_PREPARED_COVERAGE_V1' as const,
          coverage: 'ALL_RETAINED_REFERENCES_OBSERVED' as const,
          filesObservationHash,
          entryCount,
          entriesDigest,
          retainedEntriesDigest,
        };
        return Object.freeze({ ...facts, observationHash: archiveHash(facts) });
      }
      for (const row of rows) {
        if (
          !row ||
          Object.keys(row).sort().join(',') !==
            'contentHash,entryId,sourceContentHash,sourceEntryId' ||
          !Object.values(row).every(sourceHashValid) ||
          (afterSourceEntryId !== undefined &&
            row.sourceEntryId <= afterSourceEntryId)
        )
          throw invalid();
        entriesDigest = appendItemManifestEntryDigest(entriesDigest, {
          id: row.sourceEntryId,
          contentHash: row.sourceContentHash,
        });
        retainedEntriesDigest = archiveHash({
          previous: retainedEntriesDigest,
          row,
        });
        afterSourceEntryId = row.sourceEntryId;
        entryCount++;
      }
    }
  }

  private async observeFiles(
    raw: PublishedHistoryFinalCoverageInput,
    prepared: boolean,
  ) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const readPage = prepared
      ? this.store.readPublishedPreparedCoveragePage
      : this.store.readPublishedFinalCoveragePage;
    if (!readPage) throw invalid();
    let afterSourceFileId: string | undefined;
    let pageBindingHash: string | undefined;
    let fileCount = 0;
    let filesDigest = ITEM_MANIFEST_FILES_DIGEST_SEED;
    let versionsDigest = archiveHash([protocol, 'FILES']);
    let registrationsDigest = archiveHash([
      'PUBLISHED_HISTORY_PREPARED_COVERAGE_V1',
      'FILES',
    ]);

    for (;;) {
      const page = await readPage.call(this.store, {
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
          ...(prepared ? { registrationsDigest } : {}),
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
        if (!row) throw invalid();
        const { registrationDefinitionHash, ...version } = row as typeof row & {
          registrationDefinitionHash?: string;
        };
        if (
          prepared !== 'registrationDefinitionHash' in row ||
          (prepared && !sourceHashValid(registrationDefinitionHash)) ||
          Object.keys(version).sort().join(',') !==
            'attemptDefinitionHash,conservationControlsHash,fileDefinitionHash,fileId,intentDefinitionHash,permissionHash,sourceDefinitionHash,sourceFileId,versionObservationHash' ||
          !Object.values(version).every(sourceHashValid) ||
          (afterSourceFileId !== undefined &&
            row.sourceFileId <= afterSourceFileId)
        )
          throw invalid();
        filesDigest = appendItemManifestFileDigest(
          filesDigest,
          row.sourceFileId,
          row.sourceDefinitionHash,
        );
        versionsDigest = archiveHash({
          previous: versionsDigest,
          row: version,
        });
        if (prepared)
          registrationsDigest = archiveHash({
            previous: registrationsDigest,
            fileId: row.fileId,
            registrationDefinitionHash,
          });
        afterSourceFileId = row.sourceFileId;
        fileCount++;
      }
    }
  }
}
