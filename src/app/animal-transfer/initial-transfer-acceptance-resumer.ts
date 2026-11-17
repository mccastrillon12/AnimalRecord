import {
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { MongoTransferItemCapture } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import type { TransferAcceptanceProgress } from '../../context/animal-transfer/application/transfer-acceptance-execution';

/** A bounded, round-robin reader. Each resume still admits work from the original decision. */
export class InitialTransferAcceptanceResumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InitialTransferAcceptanceResumer.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private after?: string;

  constructor(
    private readonly store: Pick<
      MongoTransferItemCapture,
      'listInitialProcessingItems'
    >,
    private readonly progress: TransferAcceptanceProgress,
  ) {}

  onModuleInit() {
    this.schedule();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.resumePage().finally(() => this.schedule());
    }, 5_000).unref();
  }

  private async resumePage() {
    try {
      const page = await this.store.listInitialProcessingItems(this.after);
      this.after = page.after;
      for (const item of page.items) {
        if (this.stopped) break;
        try {
          await this.progress.resume(item);
        } catch {
          this.logger.warn('Pending transfer progress could not be confirmed');
        }
      }
    } catch {
      this.logger.warn('Pending transfer progress could not be read');
    }
  }
}
