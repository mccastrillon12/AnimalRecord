import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemStableCutAccreditationReader,
  ItemStableCutScope,
  matchItemStableCutAccreditation,
  PublishedHistoryStableCutAccreditationReader,
  matchPublishedHistoryStableCutAccreditation,
  LaterPeriodStableCutScope,
  LaterPeriodStableCutAccreditation,
  LaterPeriodStableCutAccreditationReader,
  matchLaterPeriodStableCutAccreditation,
} from '../domain/transfer-item-stable-cut-evidence';
import type { PublishedHistoryStableCutScope } from '../domain/published-history-stable-cut-scope';

type StableCutAccreditationReader<Scope, Report> = {
  readAccreditation(
    scope: Scope,
    expectedAccreditationHash: string,
  ): Promise<Report | null>;
};

/** Explicit internal composition outside the Mongo transaction. */
class StableCutAccreditationObserver<Scope, Report, Observation> {
  constructor(
    private readonly reader: StableCutAccreditationReader<Scope, Report>,
    private readonly match: (
      scope: Scope,
      report: Report,
      hash: string,
      checkedAt: number,
    ) => Observation,
    private readonly now: () => Date,
    private readonly subject: string,
  ) {}

  async observe(scope: Scope, expectedAccreditationHash: string) {
    const { observation } = await this.readForRegistration(
      scope,
      expectedAccreditationHash,
    );
    return observation;
  }

  async readForRegistration(scope: Scope, expectedAccreditationHash: string) {
    if (!sourceHashValid(expectedAccreditationHash))
      throw new InvalidArgumentError(
        `Invalid ${this.subject} stable-cut accreditation hash`,
      );
    const captured = structuredClone(scope);
    const report = await this.reader.readAccreditation(
      structuredClone(captured),
      expectedAccreditationHash,
    );
    if (!report)
      throw new ConflictError(
        `The independent ${this.subject} stable-cut accreditation is absent`,
      );
    const accreditation = structuredClone(report);
    const observation = this.match(
      captured,
      accreditation,
      expectedAccreditationHash,
      this.now().getTime(),
    );
    return Object.freeze({ accreditation, observation });
  }
}

export class ItemStableCutAccreditationObserver extends StableCutAccreditationObserver<
  ItemStableCutScope,
  NonNullable<Parameters<typeof matchItemStableCutAccreditation>[1]>,
  ReturnType<typeof matchItemStableCutAccreditation>
> {
  constructor(
    reader: ItemStableCutAccreditationReader,
    now: () => Date = () => new Date(),
  ) {
    super(reader, matchItemStableCutAccreditation, now, 'item');
  }
}

export class PublishedHistoryStableCutAccreditationObserver extends StableCutAccreditationObserver<
  PublishedHistoryStableCutScope,
  NonNullable<
    Parameters<typeof matchPublishedHistoryStableCutAccreditation>[1]
  >,
  ReturnType<typeof matchPublishedHistoryStableCutAccreditation>
> {
  constructor(
    reader: PublishedHistoryStableCutAccreditationReader,
    now: () => Date = () => new Date(),
  ) {
    super(
      reader,
      matchPublishedHistoryStableCutAccreditation,
      now,
      'published history',
    );
  }
}

export class LaterPeriodStableCutAccreditationObserver extends StableCutAccreditationObserver<
  LaterPeriodStableCutScope,
  LaterPeriodStableCutAccreditation,
  ReturnType<typeof matchLaterPeriodStableCutAccreditation>
> {
  constructor(
    reader: LaterPeriodStableCutAccreditationReader,
    now: () => Date = () => new Date(),
  ) {
    super(
      reader,
      matchLaterPeriodStableCutAccreditation,
      now,
      'later-period item',
    );
  }
}
