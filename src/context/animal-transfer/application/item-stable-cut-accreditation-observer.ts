import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
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
    if (!sourceHashValid(expectedAccreditationHash))
      throw new InvalidArgumentError(
        'Invalid item stable-cut accreditation hash',
      );
    const captured = structuredClone(scope);
    const report = await this.reader.readAccreditation(
      structuredClone(captured),
      expectedAccreditationHash,
    );
    return matchItemStableCutAccreditation(
      captured,
      report,
      expectedAccreditationHash,
      this.now().getTime(),
    );
  }
}
