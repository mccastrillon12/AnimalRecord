import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ItemCaptureInput,
  ItemCaptureStore,
  itemCaptureInput,
} from '../domain/transfer-item-capture';
import { ItemHistoricalSourceAnchorInput } from '../domain/transfer-item-copy-intent';
import type { ItemHistoricalPutDeclarationV2Input } from '../domain/transfer-item-copy-record';
import {
  ItemSourceProfileObservationInput,
  itemSourceProfileObservationInput,
  sourceProfilePreparationInput,
  sourceRetentionPreparationInput,
} from '../domain/transfer-item-historical-observation';
import {
  ItemManifestDigestInput,
  itemManifestDigestInput,
} from '../domain/transfer-item-manifest-digest';
import type { ItemSourceArtifactDraft } from '../domain/transfer-item-source-artifact';
import { ItemManifestObserver } from './item-manifest-observer';

/** Prepares the sealed dossier and source evidence through trusted internal ports. */
export class ItemManifestPreparer {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      | 'inspectCopyPreparation'
      | 'resumeManifestDigest'
      | 'confirmManifestDigest'
      | 'resumeSourceRetention'
      | 'confirmSourceRetention'
      | 'resumeSourceProfileObservation'
      | 'confirmSourceProfileObservation'
    >,
    private readonly observer: Pick<
      ItemManifestObserver,
      'observe' | 'observeHistoricalSourceRetention'
    > &
      Partial<
        Pick<
          ItemManifestObserver,
          'observeHistoricalSourceProfile' | 'sealHistoricalSourceArtifact'
        >
      >,
    private readonly expectedSourceBucketOwner?: string,
  ) {}
  async prepareFromCapture(raw: ItemCaptureInput) {
    const selector = itemCaptureInput(raw);
    const { observedSealHash } =
      await this.store.inspectCopyPreparation(selector);
    const receipt = await this.prepare({
      selector,
      expectedSealHash: observedSealHash,
    });
    return Object.freeze({ ...receipt, observedSealHash });
  }

  async prepare(raw: ItemManifestDigestInput) {
    const input = itemManifestDigestInput(raw);
    const existing = await this.store.resumeManifestDigest(input);
    if (existing) return existing;
    const observed = await this.observer.observe(input);
    return this.store.confirmManifestDigest(input, observed);
  }
  async prepareHistoricalSourceEvidence(
    raw: ItemSourceProfileObservationInput,
  ) {
    const input = itemSourceProfileObservationInput(raw);
    const retention = await this.prepareHistoricalSourceRetention(input.anchor);
    const profile = await this.prepareHistoricalSourceProfile(input);
    return Object.freeze({ retention, profile });
  }

  /** Keep the sealed declaration evidence with the caller before attempting a write. */
  async prepareHistoricalPutArtifact(
    raw: ItemSourceProfileObservationInput,
    draft: ItemSourceArtifactDraft,
  ): Promise<
    Pick<
      ItemHistoricalPutDeclarationV2Input,
      'artifact' | 'metadata' | 'expectedMetadataHash'
    >
  > {
    if (!this.observer.sealHistoricalSourceArtifact)
      throw new ConflictError(
        'A source artifact observer must be configured explicitly',
      );
    const { seal: artifact, metadata } =
      await this.observer.sealHistoricalSourceArtifact(raw, draft, {
        captureRepresentation: true,
      });
    return Object.freeze({
      artifact,
      metadata,
      expectedMetadataHash: metadata.metadataHash,
    });
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
  async prepareHistoricalSourceProfile(raw: ItemSourceProfileObservationInput) {
    if (this.expectedSourceBucketOwner === undefined)
      throw new ConflictError(
        'The expected source bucket owner must be configured explicitly',
      );
    const request = itemSourceProfileObservationInput(raw);
    const input = sourceProfilePreparationInput({
      ...request,
      expectedBucketOwner: this.expectedSourceBucketOwner,
    });
    const existing = await this.store.resumeSourceProfileObservation(input);
    if (existing) return existing;
    if (!this.observer.observeHistoricalSourceProfile)
      throw new ConflictError(
        'A source profile observer must be configured explicitly',
      );
    const observed =
      await this.observer.observeHistoricalSourceProfile(request);
    return this.store.confirmSourceProfileObservation(input, observed);
  }
}
