import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import { ItemHistoricalSourceAnchorInput } from '../domain/transfer-item-copy-intent';
import { sourceRetentionPreparationInput } from '../domain/transfer-item-historical-observation';
import {
  ItemManifestDigestInput,
  itemManifestDigestInput,
} from '../domain/transfer-item-manifest-digest';
import { ItemManifestObserver } from './item-manifest-observer';

/** Explicit trusted composition only. No DTO proof, provider, worker or dispatch. */
export class ItemManifestPreparer {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      | 'resumeManifestDigest'
      | 'confirmManifestDigest'
      | 'resumeSourceRetention'
      | 'confirmSourceRetention'
    >,
    private readonly observer: Pick<
      ItemManifestObserver,
      'observe' | 'observeHistoricalSourceRetention'
    >,
    private readonly expectedSourceBucketOwner?: string,
  ) {}
  async prepare(raw: ItemManifestDigestInput) {
    const input = itemManifestDigestInput(raw);
    const existing = await this.store.resumeManifestDigest(input);
    if (existing) return existing;
    const observed = await this.observer.observe(input);
    return this.store.confirmManifestDigest(input, observed);
  }
  async prepareHistoricalSourceRetention(raw: ItemHistoricalSourceAnchorInput) {
    if (this.expectedSourceBucketOwner === undefined)
      throw new ConflictError(
        'The expected source bucket owner must be configured explicitly',
      );
    const input = sourceRetentionPreparationInput({
      anchor: raw,
      expectedBucketOwner: this.expectedSourceBucketOwner,
    });
    const existing = await this.store.resumeSourceRetention(input);
    if (existing) return existing;
    const observed = await this.observer.observeHistoricalSourceRetention(
      input.anchor,
    );
    return this.store.confirmSourceRetention(input, observed);
  }
}
