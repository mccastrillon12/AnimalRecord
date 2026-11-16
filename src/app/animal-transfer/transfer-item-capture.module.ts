import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { ItemHistoricalCopyObserver } from '../../context/animal-transfer/application/item-historical-copy-observer';
import { ItemHistoricalPutDestinationPreparer } from '../../context/animal-transfer/application/item-historical-put-destination-preparer';
import { ItemHistoricalPutDispatcher } from '../../context/animal-transfer/application/item-historical-put-dispatcher';
import { ItemManifestObserver } from '../../context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../context/animal-transfer/application/item-manifest-preparer';
import { ItemRecipientFinalPutDispatcher } from '../../context/animal-transfer/application/item-recipient-final-put-dispatcher';
import { ItemRecipientFinalCoverageObserver } from '../../context/animal-transfer/application/item-recipient-final-coverage-observer';
import { ItemRecipientProjectionReader } from '../../context/animal-transfer/application/item-recipient-projection-reader';
import { ItemSourceObservationPreparer } from '../../context/animal-transfer/application/item-source-observation-preparer';
import {
  ItemRecipientFinalPutArtifacts,
  ItemStagingPutArtifacts,
} from '../../context/animal-transfer/application/item-staging-put-artifacts';
import { ItemStagingPutDispatcher } from '../../context/animal-transfer/application/item-staging-put-dispatcher';
import type { ItemStableCutEvidenceProducer } from '../../context/animal-transfer/application/item-stable-cut-evidence-producer';
import { TransferItemCapture } from '../../context/animal-transfer/application/transfer-item-capture';
import { OwnershipArchiveCapture } from '../../context/animal-transfer/application/ownership-archive-capture';
import { PutVersionAuditSelectionReader } from '../../context/animal-transfer/application/put-version-audit-selection';
import type { OwnershipArchiveStorage } from '../../context/animal-transfer/domain/ownership-archive';
import type { ArchiveProjectionUrls } from '../../context/animal-transfer/domain/ownership-archive-recipient-projection';
import type { ItemCaptureStore } from '../../context/animal-transfer/domain/transfer-item-capture';
import type { ItemCopyRecordStore } from '../../context/animal-transfer/domain/transfer-item-copy-record';
import type {
  ItemFixedSourceReader,
  ItemHistoricalObjectReader,
  ItemSourceProfileReader,
  ItemSourceRetentionReader,
} from '../../context/animal-transfer/domain/transfer-item-historical-observation';
import type { ItemHistoricalPutDestinationAccreditationReader } from '../../context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import type { ItemHistoricalPutTransport } from '../../context/animal-transfer/domain/transfer-item-historical-put-transport';
import type { ItemSourceArtifactReader } from '../../context/animal-transfer/domain/transfer-item-source-artifact';
import type {
  ItemRecipientFinalPutArtifactSeal,
  ItemStagingPutArtifactSeal,
} from '../../context/animal-transfer/domain/transfer-item-staging-put-artifact';
import {
  itemStableCutAccreditationSelection,
  type ItemStableCutAccreditationSelection,
} from '../../context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import { AwsItemHistoricalObjectReader } from '../../context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import { AwsPutVersionEvidencePublication } from '../../context/animal-transfer/infrastructure/storage/aws-put-version-evidence-publication';
import { AwsPutVersionEvidenceReconciliation } from '../../context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reconciliation';
import {
  MongoTransferItemCapture,
  type SourceProfileConfirmation,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import type { MongoOwnershipArchiveSource } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import {
  TRANSFER_EVENT_MODEL,
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TransferEventSchema,
  TransferNoticeSchema,
  TransferOutboxSchema,
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OwnershipArchiveSchema,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
  OwnershipArchiveFileSchema,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OwnershipArchiveEntrySchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  ITEM_COPY_RECORD_MODEL,
  ItemCopyRecordSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import {
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
  OwnershipArchiveMediaRegistrationSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';
import {
  UserEntity,
  UserSchema,
} from '../../context/user/infrastructure/persistence/mongo/user.schema';

type CaptureCopyEvidence = Readonly<{
  reader: ItemSourceRetentionReader & ItemFixedSourceReader;
  profiles: ItemSourceProfileReader & SourceProfileConfirmation['profiles'];
  expectedBucketOwner: string;
  now: () => Date;
  destinationAccreditations?: ItemHistoricalPutDestinationAccreditationReader;
}>;

export type CapturePutVersionEvidence = Readonly<{
  clients: ConstructorParameters<typeof AwsPutVersionEvidencePublication>[1];
  configuration: ConstructorParameters<
    typeof AwsPutVersionEvidencePublication
  >[2];
  history?: ConstructorParameters<
    typeof AwsPutVersionEvidenceReconciliation
  >[1];
  now?: () => Date;
}>;

export const ITEM_HISTORICAL_PUT_DISPATCHER_FACTORY = Symbol(
  'ItemHistoricalPutDispatcherFactory',
);
export type ItemHistoricalPutDispatcherFactory = (
  dispatcherInstanceId: string,
  custody: ItemSourceArtifactReader,
  transport: ItemHistoricalPutTransport,
) => ItemHistoricalPutDispatcher;

export const ITEM_STAGING_PUT_DISPATCHER_FACTORY = Symbol(
  'ItemStagingPutDispatcherFactory',
);
export type ItemStagingPutDispatcherFactory = (
  dispatcherInstanceId: string,
  custody: ItemSourceArtifactReader<ItemStagingPutArtifactSeal>,
  transport: ItemHistoricalPutTransport,
) => ItemStagingPutDispatcher;

export const ITEM_RECIPIENT_FINAL_PUT_DISPATCHER_FACTORY = Symbol(
  'ItemRecipientFinalPutDispatcherFactory',
);
export type ItemRecipientFinalPutDispatcherFactory = (
  dispatcherInstanceId: string,
  custody: ItemSourceArtifactReader<ItemRecipientFinalPutArtifactSeal>,
  transport: ItemHistoricalPutTransport,
) => ItemRecipientFinalPutDispatcher;

export const ITEM_STABLE_CUT_REGISTRAR = Symbol('ItemStableCutRegistrar');
type ProduceAndRegisterItemStableCut =
  MongoTransferItemCapture['produceAndRegisterItemStableCut'];
export type ItemStableCutRegistrar = (
  input: Parameters<ProduceAndRegisterItemStableCut>[0],
) => Promise<
  Awaited<ReturnType<ProduceAndRegisterItemStableCut>> &
    Readonly<{ commitSelection: ItemStableCutAccreditationSelection }>
>;

export const ITEM_OWNERSHIP_CLOSER = Symbol('ItemOwnershipCloser');
type CommitItemOwnership = MongoTransferItemCapture['commitItemOwnership'];
type OwnershipCommitModels = Parameters<CommitItemOwnership>[3];
export type ItemOwnershipCloser = Readonly<{
  commit(
    input: ItemStableCutAccreditationSelection,
  ): ReturnType<CommitItemOwnership>;
  readReceipt: MongoTransferItemCapture['readItemOwnershipCommit'];
  readResumePoint(
    input: Parameters<
      MongoTransferItemCapture['readItemOwnershipResumePoint']
    >[0],
  ): ReturnType<MongoTransferItemCapture['readItemOwnershipResumePoint']>;
}>;

/** Explicit provider composition only. Not imported by the app; no SDK/bootstrap/worker. */
@Module({})
export class TransferItemCaptureModule {
  static register(
    capture: Pick<OwnershipArchiveCapture, 'captureBatch'>,
    manifestKeys?: Pick<OwnershipArchiveStorage, 'keyFromUrl'> &
      Partial<Pick<ArchiveProjectionUrls, 'urlForKey'>>,
    sourceReader?: ItemHistoricalObjectReader,
    copyEvidence?: CaptureCopyEvidence,
    versionEvidence?: CapturePutVersionEvidence,
    stableCutProducer?: Pick<ItemStableCutEvidenceProducer, 'produce'>,
    ownershipSource?: MongoOwnershipArchiveSource,
  ): DynamicModule {
    if (!capture || typeof capture.captureBatch !== 'function')
      throw new Error('An explicit bound capture provider is required');
    if (
      sourceReader !== undefined &&
      (!manifestKeys ||
        typeof sourceReader?.head !== 'function' ||
        typeof sourceReader?.read !== 'function')
    )
      throw new Error(
        'An explicit source reader and manifest resolver are required',
      );
    if (
      stableCutProducer !== undefined &&
      (typeof manifestKeys?.keyFromUrl !== 'function' ||
        typeof manifestKeys.urlForKey !== 'function' ||
        typeof stableCutProducer?.produce !== 'function')
    )
      throw new Error(
        'An explicit stable-cut producer and URL codec are required',
      );
    if (
      ownershipSource !== undefined &&
      (typeof manifestKeys?.keyFromUrl !== 'function' ||
        typeof manifestKeys.urlForKey !== 'function' ||
        typeof ownershipSource?.readItemOwnershipResourceChanges !==
          'function' ||
        typeof ownershipSource?.applyItemOwnershipResourceChanges !==
          'function')
    )
      throw new Error(
        'An explicit ownership archive source and URL codec are required',
      );

    const preparationProviders: Provider[] = [];
    const preparationExports = [];
    const evidence = copyEvidence && Object.freeze({ ...copyEvidence });
    if (copyEvidence !== undefined) {
      if (
        !manifestKeys ||
        !evidence ||
        typeof evidence.reader?.readSourceRetention !== 'function' ||
        typeof evidence.reader?.readFixedSource !== 'function' ||
        typeof evidence.profiles?.readCurrentSourceProfile !== 'function' ||
        typeof evidence.profiles?.fenceActiveSourceProfile !== 'function' ||
        typeof evidence.now !== 'function' ||
        typeof evidence.expectedBucketOwner !== 'string' ||
        !/^\d{12}$/.test(evidence.expectedBucketOwner)
      )
        throw new Error(
          'Explicit source evidence readers and a profile guard are required',
        );
      const { profiles, now, expectedBucketOwner, destinationAccreditations } =
        evidence;
      preparationProviders.push({
        provide: 'ItemSourceProfileConfirmation',
        useValue: Object.freeze({
          profiles,
          now,
          assessment: Object.freeze({ expectedBucketOwner }),
        }) satisfies SourceProfileConfirmation,
      });
      if (destinationAccreditations !== undefined) {
        if (
          typeof destinationAccreditations?.readDestinationAccreditation !==
            'function' ||
          typeof profiles.readActiveSourceProfile !== 'function'
        )
          throw new Error(
            'Explicit destination accreditation and active source profile readers are required',
          );
        preparationProviders.push(
          {
            provide: ItemHistoricalPutDestinationPreparer,
            inject: ['ItemCopyRecordStore'],
            useFactory: (store: ItemCopyRecordStore) =>
              new ItemHistoricalPutDestinationPreparer(
                store,
                destinationAccreditations,
                now,
              ),
          },
          {
            provide: ITEM_HISTORICAL_PUT_DISPATCHER_FACTORY,
            inject: ['ItemCopyRecordStore', ItemManifestObserver],
            useFactory:
              (
                store: ItemCopyRecordStore,
                observer: ItemManifestObserver,
              ): ItemHistoricalPutDispatcherFactory =>
              (dispatcherInstanceId, custody, transport) =>
                new ItemHistoricalPutDispatcher(
                  dispatcherInstanceId,
                  store,
                  observer,
                  custody,
                  destinationAccreditations,
                  transport,
                ),
          },
        );
        preparationExports.push(
          ItemHistoricalPutDestinationPreparer,
          ITEM_HISTORICAL_PUT_DISPATCHER_FACTORY,
        );
      }
    }
    if (manifestKeys !== undefined) {
      if (typeof manifestKeys?.keyFromUrl !== 'function')
        throw new Error('An explicit manifest key resolver is required');
      const keyFromUrl = manifestKeys.keyFromUrl.bind(manifestKeys);
      preparationProviders.push(
        {
          provide: ItemManifestObserver,
          inject: ['ItemCaptureStore'],
          useFactory: (store: ItemCaptureStore) =>
            new ItemManifestObserver(store, keyFromUrl, evidence),
        },
        {
          provide: ItemManifestPreparer,
          inject: ['ItemCaptureStore', ItemManifestObserver],
          useFactory: (
            store: ItemCaptureStore,
            observer: ItemManifestObserver,
          ) =>
            new ItemManifestPreparer(
              store,
              observer,
              evidence?.expectedBucketOwner,
            ),
        },
      );
      preparationExports.push(ItemManifestPreparer);
      if (manifestKeys.urlForKey !== undefined) {
        if (typeof manifestKeys.urlForKey !== 'function')
          throw new Error('An explicit projection URL codec is required');
        const urlForKey = manifestKeys.urlForKey.bind(manifestKeys);
        const urls = Object.freeze({ keyFromUrl, urlForKey });
        preparationProviders.push({
          provide: ItemRecipientProjectionReader,
          inject: ['ItemCaptureStore'],
          useFactory: (store: ItemCaptureStore & ItemCopyRecordStore) =>
            new ItemRecipientProjectionReader(
              store,
              new ItemRecipientFinalCoverageObserver(store),
              urls,
            ),
        });
        preparationExports.push(ItemRecipientProjectionReader);
        if (stableCutProducer !== undefined) {
          const producer = Object.freeze({
            produce: stableCutProducer.produce.bind(stableCutProducer),
          });
          preparationProviders.push({
            provide: ITEM_STABLE_CUT_REGISTRAR,
            inject: ['ItemCaptureStore'],
            useFactory:
              (
                store: Pick<
                  MongoTransferItemCapture,
                  'produceAndRegisterItemStableCut'
                >,
              ): ItemStableCutRegistrar =>
              async (input) => {
                const registered = await store.produceAndRegisterItemStableCut(
                  input,
                  urls,
                  producer,
                );
                return Object.freeze({
                  ...registered,
                  commitSelection: itemStableCutAccreditationSelection({
                    selection: registered.selection,
                    expectedScopeHash: registered.record.scope.scopeHash,
                    expectedAccreditationHash:
                      registered.record.accreditationHash,
                  }),
                });
              },
          });
          preparationExports.push(ITEM_STABLE_CUT_REGISTRAR);
        }
        if (ownershipSource !== undefined) {
          preparationProviders.push({
            provide: ITEM_OWNERSHIP_CLOSER,
            inject: [
              'ItemCaptureStore',
              getModelToken(UserEntity.name),
              getModelToken(TRANSFER_EVENT_MODEL),
              getModelToken(TRANSFER_NOTICE_MODEL),
              getModelToken(TRANSFER_OUTBOX_MODEL),
            ],
            useFactory: (
              store: Pick<
                MongoTransferItemCapture,
                | 'commitItemOwnership'
                | 'readItemOwnershipCommit'
                | 'readItemOwnershipResumePoint'
              >,
              users: OwnershipCommitModels['users'],
              events: OwnershipCommitModels['events'],
              notices: OwnershipCommitModels['notices'],
              outbox: OwnershipCommitModels['outbox'],
            ): ItemOwnershipCloser => {
              const models = Object.freeze({ users, events, notices, outbox });
              return Object.freeze<ItemOwnershipCloser>({
                commit: (input) =>
                  store.commitItemOwnership(
                    input,
                    urls,
                    ownershipSource,
                    models,
                  ),
                readReceipt: store.readItemOwnershipCommit.bind(store),
                readResumePoint: (input) =>
                  store.readItemOwnershipResumePoint(input, urls),
              });
            },
          });
          preparationExports.push(ITEM_OWNERSHIP_CLOSER);
        }
      }
    }
    if (sourceReader !== undefined) {
      const reader = Object.freeze({
        head: sourceReader.head.bind(sourceReader),
        read: sourceReader.read.bind(sourceReader),
      });
      preparationProviders.push({
        provide: ItemSourceObservationPreparer,
        inject: ['ItemCaptureStore', ItemManifestObserver],
        useFactory: (store: ItemCaptureStore, manifest: ItemManifestObserver) =>
          new ItemSourceObservationPreparer(
            store,
            new ItemHistoricalCopyObserver(store, reader),
            manifest,
          ),
      });
      preparationExports.push(ItemSourceObservationPreparer);
    }
    if (versionEvidence) {
      const { clients, configuration, history, now } = versionEvidence;
      const objectVersions = Object.freeze({
        bucket: configuration.notificationArchive.sourceBucket,
        expectedBucketOwner:
          configuration.notificationArchive.sourceBucketOwner,
      });
      const versionReader = new AwsItemHistoricalObjectReader(
        clients.objectVersions,
        objectVersions,
      );
      preparationProviders.push(
        {
          provide: AwsPutVersionEvidencePublication,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: ItemCopyRecordStore) =>
            new AwsPutVersionEvidencePublication(
              new PutVersionAuditSelectionReader(store, history),
              clients,
              configuration,
              now,
            ),
        },
        {
          provide: AwsPutVersionEvidenceReconciliation,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: ItemCopyRecordStore) =>
            new AwsPutVersionEvidenceReconciliation(
              store,
              history,
              clients.evidenceArchive,
              clients.objectVersions,
              {
                evidenceArchive: configuration.evidenceArchive,
                objectVersions,
              },
              now,
            ),
        },
        {
          provide: ItemStagingPutArtifacts,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: ItemCopyRecordStore) =>
            new ItemStagingPutArtifacts(store, versionReader, now),
        },
        {
          provide: ItemRecipientFinalPutArtifacts,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: ItemCopyRecordStore) =>
            new ItemRecipientFinalPutArtifacts(store, versionReader, now),
        },
        {
          provide: ITEM_STAGING_PUT_DISPATCHER_FACTORY,
          inject: ['ItemCopyRecordStore', ItemStagingPutArtifacts],
          useFactory:
            (
              store: ItemCopyRecordStore,
              artifacts: ItemStagingPutArtifacts,
            ): ItemStagingPutDispatcherFactory =>
            (dispatcherInstanceId, custody, transport) =>
              new ItemStagingPutDispatcher(
                dispatcherInstanceId,
                store,
                artifacts,
                custody,
                transport,
              ),
        },
        {
          provide: ITEM_RECIPIENT_FINAL_PUT_DISPATCHER_FACTORY,
          inject: ['ItemCopyRecordStore', ItemRecipientFinalPutArtifacts],
          useFactory:
            (
              store: ItemCopyRecordStore,
              artifacts: ItemRecipientFinalPutArtifacts,
            ): ItemRecipientFinalPutDispatcherFactory =>
            (dispatcherInstanceId, custody, transport) =>
              new ItemRecipientFinalPutDispatcher(
                dispatcherInstanceId,
                store,
                artifacts,
                custody,
                transport,
              ),
        },
      );
      preparationExports.push(
        AwsPutVersionEvidencePublication,
        AwsPutVersionEvidenceReconciliation,
        ItemStagingPutArtifacts,
        ITEM_STAGING_PUT_DISPATCHER_FACTORY,
        ItemRecipientFinalPutArtifacts,
        ITEM_RECIPIENT_FINAL_PUT_DISPATCHER_FACTORY,
      );
    }
    const models = [
      { name: ITEM_COPY_RECORD_MODEL, schema: ItemCopyRecordSchema },
      {
        name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
        schema: OwnershipArchiveMediaRegistrationSchema,
      },
      { name: TRANSFER_REQUEST_MODEL, schema: TransferRequestSchema },
      { name: TRANSFER_REQUEST_ITEM_MODEL, schema: TransferRequestItemSchema },
      {
        name: TRANSFER_REQUEST_CLAIM_MODEL,
        schema: TransferRequestClaimSchema,
      },
      { name: OWNERSHIP_ARCHIVE_MODEL, schema: OwnershipArchiveSchema },
      {
        name: OWNERSHIP_ARCHIVE_FILE_MODEL,
        schema: OwnershipArchiveFileSchema,
      },
      {
        name: OWNERSHIP_ARCHIVE_ENTRY_MODEL,
        schema: OwnershipArchiveEntrySchema,
      },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
      ...(ownershipSource === undefined
        ? []
        : [
            { name: UserEntity.name, schema: UserSchema },
            { name: TRANSFER_EVENT_MODEL, schema: TransferEventSchema },
            { name: TRANSFER_NOTICE_MODEL, schema: TransferNoticeSchema },
            { name: TRANSFER_OUTBOX_MODEL, schema: TransferOutboxSchema },
          ]),
    ].map(({ name, schema }) => {
      const cloned = schema.clone();
      cloned.set('autoCreate', false);
      cloned.set('autoIndex', false);
      return { name, schema: cloned };
    });
    return {
      module: TransferItemCaptureModule,
      imports: [MongooseModule.forFeature(models)],
      providers: [
        TransferItemCapture,
        { provide: 'ItemCaptureStore', useClass: MongoTransferItemCapture },
        { provide: 'ItemCopyRecordStore', useExisting: 'ItemCaptureStore' },
        {
          provide: 'ItemCaptureBatch',
          useValue: Object.freeze({
            captureBatch: capture.captureBatch.bind(capture),
          }),
        },
        ...preparationProviders,
      ],
      exports: [
        TransferItemCapture,
        'ItemCopyRecordStore',
        ...preparationExports,
      ],
    };
  }
}
