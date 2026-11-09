import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ItemCopyRecordStore,
  ItemHistoricalPutReadInput,
  historicalPutReadInput,
} from '../domain/transfer-item-copy-record';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemHistoricalPutDestinationAccreditationReader,
  historicalPutDestinationScope,
  protectHistoricalPutDestinationFromAccreditation,
} from '../domain/transfer-item-historical-put-destination-protection';

export type ItemHistoricalPutDestinationPreparationInput =
  ItemHistoricalPutReadInput &
    Readonly<{
      expectedControlsHash: string;
      expectedAccreditationHash: string;
    }>;

/** Explicit internal composition. The accreditation lookup runs outside the write transaction. */
export class ItemHistoricalPutDestinationPreparer {
  constructor(
    private readonly store: Pick<
      ItemCopyRecordStore,
      'readHistoricalPutAttemptV2' | 'recordHistoricalPutDestinationProtection'
    >,
    private readonly accreditations: ItemHistoricalPutDestinationAccreditationReader,
  ) {}

  async prepare(raw: ItemHistoricalPutDestinationPreparationInput) {
    const { expectedControlsHash, expectedAccreditationHash, ...pins } =
      raw ?? {};
    if (
      !sourceHashValid(expectedControlsHash) ||
      !sourceHashValid(expectedAccreditationHash)
    )
      throw new ConflictError(
        'Exact destination accreditation pins are required',
      );
    const input = historicalPutReadInput(pins);
    const { definition } = await this.store.readHistoricalPutAttemptV2(input);
    const scope = historicalPutDestinationScope(
      definition,
      expectedControlsHash,
    );
    const report = await this.accreditations.readDestinationAccreditation(
      scope,
      expectedAccreditationHash,
    );
    if (!report)
      throw new ConflictError(
        'The expected destination accreditation is absent',
      );
    const protection = protectHistoricalPutDestinationFromAccreditation(
      definition,
      expectedControlsHash,
      expectedAccreditationHash,
      report,
    );
    return this.store.recordHistoricalPutDestinationProtection(
      {
        ...input,
        expectedControlsHash,
        expectedProtectionHash: protection.protectionHash,
      },
      protection,
    );
  }
}
