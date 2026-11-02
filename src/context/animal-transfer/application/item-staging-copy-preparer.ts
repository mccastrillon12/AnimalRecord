import { ItemCaptureStore } from '../domain/transfer-item-capture';
import {
  ItemHistoricalCopyPreparationInput,
  historicalCopyPreparationInput,
} from '../domain/transfer-item-copy-intent';
import { ItemHistoricalCopyObserver } from './item-historical-copy-observer';

/** Explicit trusted composition only; no DTO with MATCH, automatic worker or dispatch. */
export class ItemStagingCopyPreparer {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      'resumeStagingCopy' | 'confirmHistoricalObservation'
    >,
    private readonly observer: Pick<ItemHistoricalCopyObserver, 'observe'>,
  ) {}
  async prepare(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    const existing = await this.store.resumeStagingCopy(input);
    if (existing) return existing;
    // All object I/O finishes before the store opens the confirmation transaction.
    const observation = await this.observer.observe(input);
    return this.store.confirmHistoricalObservation(input, observation);
  }
}
