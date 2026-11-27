import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TransferRequests } from '../../context/animal-transfer/application/transfer-requests';
import type { DueTransfer } from '../../context/animal-transfer/domain/transfer-request';

@Injectable()
export class TransferExpirationRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferExpirationRunner.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private after?: DueTransfer;

  constructor(private readonly requests: TransferRequests) {}

  onModuleInit() {
    this.schedule(0);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.runPage().finally(() => this.schedule(60_000));
    }, delay).unref();
  }

  private async runPage() {
    try {
      this.after = await this.requests.expirePage(this.after);
    } catch {
      this.logger.warn('Pending transfer expirations could not be read');
    }
  }
}
