import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ItemCopyRecordStore,
  ItemHistoricalPutReadInput,
  historicalPutReadInput,
} from '../domain/transfer-item-copy-record';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemHistoricalPutDestinationAccreditationReader,
  evaluateHistoricalPutDestinationAdmission,
  historicalPutDestinationScope,
  protectHistoricalPutDestinationFromAccreditation,
} from '../domain/transfer-item-historical-put-destination-protection';

export type ItemHistoricalPutDestinationPreparationInput =
  ItemHistoricalPutReadInput &
    Readonly<{
      expectedControlsHash: string;
      expectedAccreditationHash: string;
    }>;
export type ItemHistoricalPutDestinationAdmissionInput =
  ItemHistoricalPutDestinationPreparationInput &
    Readonly<{ expectedProtectionHash: string }>;

/** Explicit internal composition. The accreditation lookup runs outside the write transaction. */
export class ItemHistoricalPutDestinationPreparer {
  constructor(
    private readonly store: Pick<
      ItemCopyRecordStore,
      | 'readHistoricalPutAttemptV2'
      | 'recordHistoricalPutDestinationProtection'
      | 'readHistoricalPutDestinationProtection'
    >,
    private readonly accreditations: ItemHistoricalPutDestinationAccreditationReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prepare(raw: ItemHistoricalPutDestinationPreparationInput) {
    const { input, protection } = await this.readAccreditedProtection(raw);
    return this.store.recordHistoricalPutDestinationProtection(
      input,
      protection,
    );
  }

  /** Observational only. A future permission must repeat the check under its write fences. */
  async assessAdmission(raw: ItemHistoricalPutDestinationAdmissionInput) {
    const { expectedProtectionHash, ...pins } = raw ?? {};
    if (!sourceHashValid(expectedProtectionHash))
      throw new ConflictError(
        'The expected destination protection hash is required',
      );
    const { input, protection } = await this.readAccreditedProtection(pins);
    if (protection.protectionHash !== expectedProtectionHash)
      throw new ConflictError(
        'The expected destination protection does not match the accreditation',
      );
    const receipt =
      await this.store.readHistoricalPutDestinationProtection(input);
    if (!receipt)
      throw new ConflictError('The expected destination protection is absent');
    return evaluateHistoricalPutDestinationAdmission(
      receipt.protection,
      protection,
      this.now().getTime(),
    );
  }

  private async readAccreditedProtection(
    raw: ItemHistoricalPutDestinationPreparationInput,
  ) {
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
    return {
      input: {
        ...input,
        expectedControlsHash,
        expectedProtectionHash: protection.protectionHash,
      },
      protection,
    };
  }
}
