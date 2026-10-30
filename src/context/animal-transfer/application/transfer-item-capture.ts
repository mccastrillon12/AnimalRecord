import {
  Inject,
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DomainError } from '../../shared/domain/DomainError';
import {
  ItemCaptureInput,
  ItemCaptureStore,
  itemCaptureInput,
} from '../domain/transfer-item-capture';
import { OwnershipArchiveCapture } from './ownership-archive-capture';

/** One explicit preparation step. No start/reacquire/copyBatch/worker/ownership commit. */
@Injectable()
export class TransferItemCapture {
  constructor(
    @Inject('ItemCaptureStore') private readonly store: ItemCaptureStore,
    @Inject('ItemCaptureBatch')
    private readonly capture: Pick<OwnershipArchiveCapture, 'captureBatch'>,
  ) {}
  observe(raw: ItemCaptureInput) {
    return this.store.observe(itemCaptureInput(raw));
  }
  async advance(raw: ItemCaptureInput) {
    const input = itemCaptureInput(raw);
    const admitted = await this.store.admit(input);
    if ('progress' in admitted)
      return { ...admitted.progress, callback: 'NOT_INVOKED' as const };
    try {
      await this.capture.captureBatch(
        admitted.scope.archiveId,
        admitted.scope.expectation,
      );
      return {
        ...(await this.store.observe(input)),
        callback: 'RETURNED' as const,
      };
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpException)
        throw error;
      throw new ServiceUnavailableException(
        'Item capture progress is uncertain; reobserve the same item and expected revision without releasing its reservation',
      );
    }
  }
}
