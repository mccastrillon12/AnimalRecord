import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AcceptanceSelection } from '../domain/transfer-acceptance-preparation';
import { ItemCaptureIdentity } from '../domain/transfer-item-capture';
import { TransferAcceptanceStart } from './transfer-acceptance-start';

export const TRANSFER_ACCEPTANCE_PROGRESS = Symbol(
  'TransferAcceptanceProgress',
);

export interface TransferAcceptanceProgress {
  // Resume from persisted state. The identity grants no permission to resend a PUT.
  resume(item: ItemCaptureIdentity): Promise<void>;
}

@Injectable()
export class TransferAcceptanceExecution {
  private readonly logger = new Logger(TransferAcceptanceExecution.name);

  constructor(
    private readonly acceptance: TransferAcceptanceStart,
    @Inject(TRANSFER_ACCEPTANCE_PROGRESS)
    private readonly progress: TransferAcceptanceProgress,
  ) {}

  async start(input: AcceptanceSelection) {
    const receipt = await this.acceptance.start(input);
    try {
      for (const { itemId } of receipt.binding.selected) {
        await this.progress.resume({
          actorId: input.actorId,
          transferId: receipt.transferId,
          itemId,
        });
      }
    } catch {
      this.logger.warn(
        'Transfer decision is recorded but item progress could not be confirmed',
      );
      throw new ServiceUnavailableException(
        'Transfer decision was recorded; retry the same decision with the same Idempotency-Key to check progress',
      );
    }
    return receipt;
  }
}
