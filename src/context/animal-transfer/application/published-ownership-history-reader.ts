import {
  PublishedHistoryPageInput,
  PublishedHistoryPeriodsInput,
  PublishedOwnershipHistorySource,
  publishedHistoryPageInput,
  publishedHistoryPeriodsInput,
} from '../domain/published-ownership-history';

/** Internal read-only composition for discovery and opening a published period. */
export class PublishedOwnershipHistoryReader {
  constructor(
    private readonly history: PublishedOwnershipHistorySource,
    private readonly keyFromUrl: (url: string) => string | undefined,
  ) {}

  list(raw: PublishedHistoryPeriodsInput) {
    return this.history.listPublishedOwnershipPeriods(
      publishedHistoryPeriodsInput(raw),
    );
  }

  read(raw: PublishedHistoryPageInput) {
    return this.history.readPublishedOwnershipHistory(
      publishedHistoryPageInput(raw),
      this.keyFromUrl,
    );
  }
}
