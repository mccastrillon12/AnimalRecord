import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import type { InitialCopyDispatchPreparation } from '../../application/initial-item-copy-execution';
import type { ItemSourceObservationPreparer } from '../../application/item-source-observation-preparer';
import type { ItemManifestPreparer } from '../../application/item-manifest-preparer';
import type { ItemHistoricalPutDestinationPreparer } from '../../application/item-historical-put-destination-preparer';
import type { ItemHistoricalPutDispatcher } from '../../application/item-historical-put-dispatcher';
import type { ItemStagingPutDispatcher } from '../../application/item-staging-put-dispatcher';
import type { ItemRecipientFinalPutDispatcher } from '../../application/item-recipient-final-put-dispatcher';
import type {
  ItemStagingPutArtifacts,
  ItemRecipientFinalPutArtifacts,
} from '../../application/item-staging-put-artifacts';
import { archiveHash } from '../../domain/ownership-archive';
import type { ItemCaptureStore } from '../../domain/transfer-item-capture';
import type { ItemCopyRecordStore } from '../../domain/transfer-item-copy-record';
import {
  itemSourceProfileObservationInput,
  matchActiveItemSourceProfile,
  type ItemSourceProfileObservationInput,
  type ItemSourceProfileReader,
} from '../../domain/transfer-item-historical-observation';
import { buildItemHistoricalPutAttemptV2 } from '../../domain/transfer-item-historical-put-attempt';
import type { ItemStagingPutAttempt } from '../../domain/transfer-item-staging-put-attempt';
import type { ItemRecipientFinalPutAttempt } from '../../domain/transfer-item-recipient-final-put-attempt';
import type {
  ItemHistoricalPutDestinationAccreditation,
  ItemStagingPutDestinationAccreditation,
  ItemRecipientFinalPutDestinationAccreditation,
} from '../../domain/transfer-item-historical-put-destination-protection';
import type { ItemPutTransport } from '../../domain/transfer-item-historical-put-transport';
import {
  InMemoryItemSourceArtifactCustody,
  InMemoryItemStagingPutArtifactCustody,
  InMemoryItemRecipientFinalPutArtifactCustody,
} from './in-memory-item-source-artifact-custody';

type Stage = Parameters<InitialCopyDispatchPreparation['dispatchFresh']>[0];

export interface InitialPutEvidenceInputs {
  requiredThrough: InitialCopyDispatchPreparation['requiredThrough'];
  source(input: Stage): Promise<ItemSourceProfileObservationInput | null>;
  historicalDestination(
    attempt: ReturnType<typeof buildItemHistoricalPutAttemptV2>,
    requiredThrough: string,
  ): Promise<ItemHistoricalPutDestinationAccreditation | null>;
  stagingDestination(
    attempt: ItemStagingPutAttempt,
    requiredThrough: string,
  ): Promise<ItemStagingPutDestinationAccreditation | null>;
  finalDestination(
    attempt: ItemRecipientFinalPutAttempt,
    requiredThrough: string,
  ): Promise<ItemRecipientFinalPutDestinationAccreditation | null>;
}

export type InitialPutConfiguration = Readonly<{
  evidenceInputs: InitialPutEvidenceInputs;
  transport: ItemPutTransport;
  custody: ConstructorParameters<typeof InMemoryItemSourceArtifactCustody>[0];
}>;

type Store = Pick<
  ItemCaptureStore,
  'readHistoricalSourceForAnchor' | 'readHistoricalCopy'
> &
  Pick<
    ItemCopyRecordStore,
    | 'openCopyGate'
    | 'declareHistoricalPutAttemptV2'
    | 'prepareStagingPutAttempt'
    | 'prepareRecipientFinalPutAttempt'
    | 'declareStagingPutAttempt'
    | 'declareRecipientFinalPutAttempt'
  >;

type PutServices = Readonly<{
  store: Store;
  sources: Pick<ItemSourceObservationPreparer, 'prepareFromManifest'>;
  manifests: Pick<
    ItemManifestPreparer,
    'prepareHistoricalSourceEvidence' | 'prepareHistoricalPutArtifact'
  >;
  historicalDestination: Pick<ItemHistoricalPutDestinationPreparer, 'prepare'>;
  stagingArtifacts: Pick<ItemStagingPutArtifacts, 'seal'>;
  finalArtifacts: Pick<ItemRecipientFinalPutArtifacts, 'seal'>;
  historical(
    id: string,
    custody: InMemoryItemSourceArtifactCustody,
    transport: ItemPutTransport,
  ): Pick<ItemHistoricalPutDispatcher, 'dispatch'>;
  staging(
    id: string,
    custody: InMemoryItemStagingPutArtifactCustody,
    transport: ItemPutTransport,
  ): Pick<ItemStagingPutDispatcher, 'dispatch'>;
  final(
    id: string,
    custody: InMemoryItemRecipientFinalPutArtifactCustody,
    transport: ItemPutTransport,
  ): Pick<ItemRecipientFinalPutDispatcher, 'dispatch'>;
}>;

/** Prepares only fresh attempts. The dispatcher still owns the permit and single send. */
export class InitialItemPutPreparation implements InitialCopyDispatchPreparation {
  constructor(
    private readonly config: InitialPutConfiguration,
    private readonly expectedBucketOwner: string,
    private readonly profiles: ItemSourceProfileReader,
    private readonly services: PutServices,
  ) {}

  requiredThrough(
    input: Parameters<InitialCopyDispatchPreparation['requiredThrough']>[0],
  ) {
    return this.config.evidenceInputs.requiredThrough(input);
  }

  async dispatchFresh(input: Stage): Promise<void> {
    const provided = await this.config.evidenceInputs.source(input);
    if (!provided) return;
    const source = itemSourceProfileObservationInput(provided);
    const { anchor } = source;
    const { preparation } = anchor;
    if (
      anchor.expectedManifestHash !== input.expectedManifestHash ||
      preparation.expectedSealHash !== input.expectedSealHash ||
      preparation.fileId !== input.fileId ||
      preparation.expectedFileDefinitionHash !==
        input.expectedFileDefinitionHash ||
      archiveHash(preparation.selector) !== archiveHash(input.selector)
    )
      throw new ConflictError(
        'The copy source evidence belongs to another manifest file',
      );
    const ids = { attemptId: randomUUID(), dispatcherInstanceId: randomUUID() };

    if (input.protocol === 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1') {
      await this.historical(source, ids, input.requiredThrough);
      return;
    }
    if (!input.predecessor)
      throw new ConflictError('The previous copy version is required');
    const version = { anchor, source: input.predecessor };
    if (input.protocol === 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1')
      await this.staging(version, ids, input.requiredThrough);
    else await this.final(version, ids, input.requiredThrough);
  }

  private async historical(
    source: ItemSourceProfileObservationInput,
    ids: { attemptId: string; dispatcherInstanceId: string },
    requiredThrough: string,
  ) {
    const { store, sources, manifests, historicalDestination } = this.services;
    const { anchor, expectedProfile } = source;
    await sources.prepareFromManifest(anchor);
    await manifests.prepareHistoricalSourceEvidence(source);
    const material = await store.readHistoricalSourceForAnchor(anchor);
    const custody = new InMemoryItemSourceArtifactCustody(this.config.custody);
    const proof = await manifests.prepareHistoricalPutArtifact(
      source,
      custody.createDraft(material.source.revision.size),
    );
    const context = await store.readHistoricalCopy(
      anchor.preparation,
      anchor.expectedManifestHash,
    );
    const definition = buildItemHistoricalPutAttemptV2(context, {
      ...ids,
      ...proof,
      anchor: material,
      profile: matchActiveItemSourceProfile(
        await this.profiles.readCurrentSourceProfile(expectedProfile.id),
        expectedProfile,
      ),
      expectedBucketOwner: this.expectedBucketOwner,
    });
    const accreditation =
      await this.config.evidenceInputs.historicalDestination(
        definition,
        requiredThrough,
      );
    if (!accreditation) return;
    const opened = await store.openCopyGate(anchor.preparation.selector);
    const declaration = await store.declareHistoricalPutAttemptV2({
      ...source,
      ...ids,
      ...proof,
      expectedGateRevision: opened.gateRevision,
    });
    const pins = {
      ...source,
      attemptId: definition.id,
      expectedAttemptDefinitionHash: definition.definitionHash,
      expectedGateRevision: declaration.gateRevision,
      expectedAccreditationHash: archiveHash(accreditation),
      expectedControlsHash: accreditation.scope.controlsHash,
    };
    const protectedDestination = await historicalDestination.prepare(pins);
    await this.services
      .historical(ids.dispatcherInstanceId, custody, this.config.transport)
      .dispatch({
        ...pins,
        expectedGateRevision: protectedDestination.gateRevision,
        expectedProtectionHash: protectedDestination.protection.protectionHash,
        authorizationId: randomUUID(),
      });
  }

  private async staging(
    input: Pick<
      Parameters<Store['prepareStagingPutAttempt']>[0],
      'anchor' | 'source'
    >,
    ids: { attemptId: string; dispatcherInstanceId: string },
    requiredThrough: string,
  ) {
    const { store, stagingArtifacts } = this.services;
    const { definition, preparation, gateRevision } =
      await store.prepareStagingPutAttempt({ ...input, ...ids });
    const accreditation = await this.config.evidenceInputs.stagingDestination(
      definition,
      requiredThrough,
    );
    if (!accreditation) return;
    const pins = {
      ...input,
      attemptId: definition.id,
      expectedAttemptDefinitionHash: definition.definitionHash,
      expectedStagingIntentHash: preparation.intentDefinitionHash,
      expectedAccreditationHash: archiveHash(accreditation),
      expectedControlsHash: accreditation.scope.controlsHash,
    };
    const declaration = await store.declareStagingPutAttempt(
      {
        ...pins,
        dispatcherInstanceId: ids.dispatcherInstanceId,
        expectedGateRevision: gateRevision,
      },
      accreditation,
    );
    const read = { ...pins, expectedGateRevision: declaration.gateRevision };
    const custody = new InMemoryItemStagingPutArtifactCustody(
      this.config.custody,
    );
    const artifact = await stagingArtifacts.seal(
      read,
      custody.createDraft(definition.request.contentLength),
    );
    await this.services
      .staging(ids.dispatcherInstanceId, custody, this.config.transport)
      .dispatch({
        ...read,
        authorizationId: randomUUID(),
        artifact,
      });
  }

  private async final(
    input: Pick<
      Parameters<Store['prepareRecipientFinalPutAttempt']>[0],
      'anchor' | 'source'
    >,
    ids: { attemptId: string; dispatcherInstanceId: string },
    requiredThrough: string,
  ) {
    const { store, finalArtifacts } = this.services;
    const { definition, preparation, gateRevision } =
      await store.prepareRecipientFinalPutAttempt({ ...input, ...ids });
    const accreditation = await this.config.evidenceInputs.finalDestination(
      definition,
      requiredThrough,
    );
    if (!accreditation) return;
    const pins = {
      ...input,
      attemptId: definition.id,
      expectedAttemptDefinitionHash: definition.definitionHash,
      expectedFinalIntentHash: preparation.intentDefinitionHash,
      expectedAccreditationHash: archiveHash(accreditation),
      expectedControlsHash: accreditation.scope.controlsHash,
    };
    const declaration = await store.declareRecipientFinalPutAttempt(
      {
        ...pins,
        dispatcherInstanceId: ids.dispatcherInstanceId,
        expectedGateRevision: gateRevision,
      },
      accreditation,
    );
    const read = { ...pins, expectedGateRevision: declaration.gateRevision };
    const custody = new InMemoryItemRecipientFinalPutArtifactCustody(
      this.config.custody,
    );
    const artifact = await finalArtifacts.seal(
      read,
      custody.createDraft(definition.request.contentLength),
    );
    await this.services
      .final(ids.dispatcherInstanceId, custody, this.config.transport)
      .dispatch({
        ...read,
        authorizationId: randomUUID(),
        artifact,
      });
  }
}
