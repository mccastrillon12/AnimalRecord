import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  ItemRecipientFinalCoverageInput,
  recipientFinalCoverageInput,
} from './transfer-item-recipient-final-coverage';

/** Comparison pins for a candidate. The seal binds the original reservation. */
export type ItemRecipientProjectionSelection = ItemRecipientFinalCoverageInput &
  Readonly<{
    expectedPreparedCoverageHash: string;
    expectedProjectionHash: string;
  }>;

export function itemRecipientProjectionSelection(
  raw: ItemRecipientProjectionSelection,
): ItemRecipientProjectionSelection {
  const { expectedPreparedCoverageHash, expectedProjectionHash, ...input } =
    raw ?? {};
  if (
    ![expectedPreparedCoverageHash, expectedProjectionHash].every(
      sourceHashValid,
    )
  )
    throw new InvalidArgumentError('Invalid recipient projection selection');
  return Object.freeze({
    ...recipientFinalCoverageInput(input),
    expectedPreparedCoverageHash,
    expectedProjectionHash,
  });
}
