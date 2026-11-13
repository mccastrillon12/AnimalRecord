import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ArchiveDefinition,
  ArchiveEntry,
  archiveHash,
} from '../domain/ownership-archive';
import {
  PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL,
  PublishedHistoryFinalMediaRegistration,
} from '../domain/ownership-archive-media-registration';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import {
  PublishedHistoryFinalCoverageInput,
  PublishedHistoryFinalCoveragePage,
  PublishedHistoryRetainedEntryPage,
  PublishedHistoryProjectionEntryPage,
  PublishedHistoryProjectionMediaPage,
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
        | 'readPublishedPreparedCoveragePage'
        | 'readPublishedRetainedEntryPage'
        | 'readPublishedProjectionEntryPage'
        | 'readPublishedProjectionMediaPage'
      >,
  ) {}

  observe(raw: PublishedHistoryFinalCoverageInput) {
    return this.observeFiles(raw, false);
  }

  observePrepared(raw: PublishedHistoryFinalCoverageInput) {
    return this.observePreparedCoverage(raw);
  }

  async observeProjectionData(raw: PublishedHistoryFinalCoverageInput) {
    const projection: {
      entries: ArchiveEntry[];
      media: PublishedHistoryFinalMediaRegistration[];
      sourceDefinition?: ArchiveDefinition;
    } = { entries: [], media: [] };
    const coverage = await this.observePreparedCoverage(raw, projection);
    if (!projection.sourceDefinition) throw invalid();
    return Object.freeze({
      coverage,
      sourceDefinition: Object.freeze(projection.sourceDefinition),
      entries: Object.freeze(projection.entries),
      media: Object.freeze(projection.media),
    });
  }

  private async observePreparedCoverage(
    raw: PublishedHistoryFinalCoverageInput,
    projection?: {
      entries: ArchiveEntry[];
      media: PublishedHistoryFinalMediaRegistration[];
      sourceDefinition?: ArchiveDefinition;
    },
  ) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const { observationHash: filesObservationHash, ...files } =
      await this.observeFiles(input, true, projection?.media);
    const readEntries = projection
      ? this.store.readPublishedProjectionEntryPage
      : this.store.readPublishedRetainedEntryPage;
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
      const page: PublishedHistoryRetainedEntryPage &
        Partial<
          Pick<
            PublishedHistoryProjectionEntryPage,
            'entries' | 'sourceDefinition'
          >
        > = await readEntries.call(this.store, {
        ...input,
        afterSourceEntryId,
      });
      const { rows, entries, sourceDefinition, ...binding } = page;
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
        (projection &&
          (!Array.isArray(page.entries) || entries?.length !== rows.length)) ||
        rows.length > ITEM_MANIFEST_PAGE_SIZE ||
        entryCount + rows.length > binding.sourceEntryCount
      )
        throw invalid();
      sourceBindingHash = currentBindingHash;
      if (projection) {
        if (
          !sourceDefinition ||
          sourceDefinition.id !== files.sourceArchiveId ||
          sourceDefinition.ownershipVersion !== 1 ||
          (projection.sourceDefinition &&
            archiveHash(projection.sourceDefinition) !==
              archiveHash(sourceDefinition))
        )
          throw invalid();
        projection.sourceDefinition ??= structuredClone(sourceDefinition);
      }
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
      for (const [index, row] of rows.entries()) {
        if (
          !row ||
          Object.keys(row).sort().join(',') !==
            'contentHash,entryId,sourceContentHash,sourceEntryId' ||
          !Object.values(row).every(sourceHashValid) ||
          (afterSourceEntryId !== undefined &&
            row.sourceEntryId <= afterSourceEntryId)
        )
          throw invalid();
        if (projection) {
          const entry = entries?.[index];
          if (
            !entry ||
            entry.kind !== 'RETAINED_RECORD' ||
            entry.archiveId !== input.archiveId ||
            entry.id !== row.entryId ||
            entry.retained?.sourceArchiveId !== files.sourceArchiveId ||
            entry.retained.sourcePublicationHash !==
              input.expectedPublicationHash ||
            entry.retained.sourceEntryId !== row.sourceEntryId ||
            entry.retained.sourceContentHash !== row.sourceContentHash ||
            entry.contentHash !== row.contentHash ||
            entry.contentHash !==
              archiveHash({
                kind: entry.kind,
                payload: entry.payload,
                fileBindings: entry.fileBindings,
                retained: entry.retained,
              })
          )
            throw invalid();
          projection.entries.push(structuredClone(entry));
        }
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
    projectionMedia?: PublishedHistoryFinalMediaRegistration[],
  ) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const readPage = projectionMedia
      ? this.store.readPublishedProjectionMediaPage
      : prepared
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
      const page: PublishedHistoryFinalCoveragePage &
        Partial<Pick<PublishedHistoryProjectionMediaPage, 'media'>> =
        await readPage.call(this.store, {
          ...input,
          afterSourceFileId,
        });
      const { rows, media, ...binding } = page;
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
        (projectionMedia &&
          (!Array.isArray(page.media) || media?.length !== rows.length)) ||
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

      for (const [index, row] of rows.entries()) {
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
        if (projectionMedia) {
          const registration = media?.[index];
          if (
            registration?.protocol !==
              PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL ||
            registration.archiveId !== input.archiveId ||
            registration.archiveDefinitionHash !==
              binding.archiveDefinitionHash ||
            registration.fileId !== row.fileId ||
            registration.fileDefinitionHash !== row.fileDefinitionHash ||
            registration.definitionHash !== registrationDefinitionHash
          )
            throw invalid();
          const { definitionHash, ...facts } = registration;
          if (archiveHash(facts) !== definitionHash) throw invalid();
          projectionMedia.push(structuredClone(registration));
        }
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
