import { ItemCaptureStore } from '../domain/transfer-item-capture';
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
      'resumeManifestDigest' | 'confirmManifestDigest'
    >,
    private readonly observer: Pick<ItemManifestObserver, 'observe'>,
  ) {}
  async prepare(raw: ItemManifestDigestInput) {
    const input = itemManifestDigestInput(raw);
    const existing = await this.store.resumeManifestDigest(input);
    if (existing) return existing;
    const observed = await this.observer.observe(input);
    return this.store.confirmManifestDigest(input, observed);
  }
}
