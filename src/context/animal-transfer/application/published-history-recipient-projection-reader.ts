import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ArchiveProjectionUrls,
  projectPublishedHistoryRecipientEntries,
} from '../domain/ownership-archive-recipient-projection';
import {
  PublishedHistoryFinalCoverageInput,
  publishedHistoryFinalCoverageInput,
} from '../domain/published-history-final-coverage';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import type { PublishedHistoryFinalCoverageObserver } from './published-history-final-coverage-observer';

export type PublishedHistoryRecipientProjectionInput =
  PublishedHistoryFinalCoverageInput &
    Readonly<{ expectedPreparedCoverageHash: string }>;

export type PublishedHistoryRecipientProjectionSelection =
  PublishedHistoryRecipientProjectionInput &
    Readonly<{ expectedProjectionHash: string }>;

export function publishedHistoryRecipientProjectionSelection(
  raw: PublishedHistoryRecipientProjectionSelection,
): PublishedHistoryRecipientProjectionSelection {
  const input = publishedHistoryFinalCoverageInput(raw);
  const { expectedPreparedCoverageHash, expectedProjectionHash } = raw;
  if (
    ![expectedPreparedCoverageHash, expectedProjectionHash].every(
      sourceHashValid,
    )
  )
    throw new ConflictError('Invalid published history projection selection');
  return Object.freeze({
    ...input,
    expectedPreparedCoverageHash,
    expectedProjectionHash,
  });
}

/** Private in-memory candidate under the original retained-history selection. */
export class PublishedHistoryRecipientProjectionReader {
  constructor(
    private readonly observer: Pick<
      PublishedHistoryFinalCoverageObserver,
      'observeProjectionData'
    >,
    private readonly urls: ArchiveProjectionUrls,
  ) {}

  async read(raw: PublishedHistoryRecipientProjectionInput) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const expectedPreparedCoverageHash = raw.expectedPreparedCoverageHash;
    if (!sourceHashValid(expectedPreparedCoverageHash))
      throw new ConflictError(
        'Invalid published history prepared coverage hash',
      );
    const { coverage, sourceDefinition, entries, media } =
      await this.observer.observeProjectionData(input);
    if (
      coverage.observationHash !== expectedPreparedCoverageHash ||
      coverage.archiveId !== input.archiveId ||
      coverage.archiveDefinitionHash !== input.expectedArchiveDefinitionHash ||
      coverage.reservationEpoch !== input.expectedReservationEpoch ||
      coverage.publicationHash !== input.expectedPublicationHash ||
      coverage.sourceManifestHash !== input.expectedSourceManifestHash ||
      coverage.requiredThrough !== input.requiredThrough ||
      coverage.entryCount !== entries.length ||
      coverage.fileCount !== media.length
    )
      throw new ConflictError(
        'The retained projection does not match the prepared coverage',
      );
    const projection = {
      protocol: 'PUBLISHED_HISTORY_RECIPIENT_PROJECTION_V1' as const,
      archiveId: coverage.archiveId,
      archiveDefinitionHash: coverage.archiveDefinitionHash,
      reservationEpoch: coverage.reservationEpoch,
      reservationBindingHash: coverage.reservationBindingHash,
      sourceArchiveId: coverage.sourceArchiveId,
      publicationHash: coverage.publicationHash,
      sourceManifestHash: coverage.sourceManifestHash,
      preparedCoverageHash: coverage.observationHash,
      requiredThrough: coverage.requiredThrough,
      entries: Object.freeze(
        projectPublishedHistoryRecipientEntries(
          sourceDefinition,
          entries,
          media,
          this.urls,
        ),
      ),
      media,
      reservation: 'OBSERVED_ONLY' as const,
      stableCut: 'NOT_ASSESSED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    };
    return Object.freeze({
      ...projection,
      projectionHash: archiveHash(projection),
    });
  }

  async prepareSelection(raw: PublishedHistoryRecipientProjectionInput) {
    const input = publishedHistoryFinalCoverageInput(raw);
    const projection = await this.read({
      ...input,
      expectedPreparedCoverageHash: raw.expectedPreparedCoverageHash,
    });
    const selection = publishedHistoryRecipientProjectionSelection({
      ...input,
      expectedPreparedCoverageHash: projection.preparedCoverageHash,
      expectedProjectionHash: projection.projectionHash,
    });
    return Object.freeze({ selection, projection });
  }
}
