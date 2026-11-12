import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemStableCutAccreditationReader,
  ItemStableCutScope,
  matchItemStableCutAccreditation,
} from '../domain/transfer-item-stable-cut-evidence';

/** Explicit internal composition outside the Mongo transaction. */
export class ItemStableCutAccreditationObserver {
  constructor(
    private readonly reader: ItemStableCutAccreditationReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async observe(scope: ItemStableCutScope, expectedAccreditationHash: string) {
    const { observation } = await this.readForRegistration(
      scope,
      expectedAccreditationHash,
    );
    return observation;
  }

  async readForRegistration(
    scope: ItemStableCutScope,
    expectedAccreditationHash: string,
  ) {
    if (!sourceHashValid(expectedAccreditationHash))
      throw new InvalidArgumentError(
        'Invalid item stable-cut accreditation hash',
      );
    const captured = structuredClone(scope);
    const report = await this.reader.readAccreditation(
      structuredClone(captured),
      expectedAccreditationHash,
    );
    if (!report)
      throw new ConflictError(
        'The independent item stable-cut accreditation is absent',
      );
    const accreditation = structuredClone(report);
    const observation = matchItemStableCutAccreditation(
      captured,
      accreditation,
      expectedAccreditationHash,
      this.now().getTime(),
    );
    return Object.freeze({ accreditation, observation });
  }
}
