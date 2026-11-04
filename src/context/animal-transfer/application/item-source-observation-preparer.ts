import { ItemCaptureStore } from '../domain/transfer-item-capture';
import {
  ItemHistoricalCopyPreparationInput,
  historicalCopyPreparationInput,
} from '../domain/transfer-item-copy-intent';
import { ItemHistoricalCopyObserver } from './item-historical-copy-observer';

/** Explicit trusted composition only. No HTTP, automatic worker or dispatch. */
export class ItemSourceObservationPreparer {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      'resumeSourceObservation' | 'confirmSourceObservation'
    >,
    private readonly observer: Pick<
      ItemHistoricalCopyObserver,
      'observeSource'
    >,
  ) {}
  async prepare(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    const existing = await this.store.resumeSourceObservation(input);
    if (existing) return existing;
    // Object I/O completes before the confirmation transaction opens.
    const observation = await this.observer.observeSource(input);
    return this.store.confirmSourceObservation(input, observation);
  }
}
