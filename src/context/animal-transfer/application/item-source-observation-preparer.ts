import { ItemCaptureStore } from '../domain/transfer-item-capture';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalSourceAnchorInput,
  historicalCopyPreparationInput,
  historicalSourceAnchorInput,
} from '../domain/transfer-item-copy-intent';
import { ItemHistoricalCopyObserver } from './item-historical-copy-observer';
import { ItemManifestObserver } from './item-manifest-observer';

/** Explicit trusted composition only. No HTTP, automatic worker or dispatch. */
export class ItemSourceObservationPreparer {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      | 'prepareHistoricalCopy'
      | 'resumeSourceObservation'
      | 'confirmSourceObservation'
    >,
    private readonly observer: Pick<
      ItemHistoricalCopyObserver,
      'observeSource'
    >,
    private readonly manifest?: Pick<
      ItemManifestObserver,
      'verifyHistoricalFileMembership'
    >,
  ) {}

  async prepareFromManifest(raw: ItemHistoricalSourceAnchorInput) {
    if (!this.manifest)
      throw new ConflictError(
        'A manifest observer must be configured explicitly',
      );
    const input = historicalSourceAnchorInput(raw);
    const { preparation, expectedManifestHash } = input;
    await this.manifest.verifyHistoricalFileMembership(input);
    await this.store.prepareHistoricalCopy(preparation, expectedManifestHash);
    return this.prepareObservation(preparation, expectedManifestHash);
  }

  async prepare(raw: ItemHistoricalCopyPreparationInput) {
    return this.prepareObservation(historicalCopyPreparationInput(raw));
  }

  private async prepareObservation(
    input: ItemHistoricalCopyPreparationInput,
    expectedManifestHash?: string,
  ) {
    const existing = await this.store.resumeSourceObservation(
      input,
      expectedManifestHash,
    );
    if (existing) return existing;
    // Object I/O completes before the confirmation transaction opens.
    const observation = await this.observer.observeSource(
      input,
      expectedManifestHash,
    );
    return this.store.confirmSourceObservation(
      input,
      observation,
      expectedManifestHash,
    );
  }
}
