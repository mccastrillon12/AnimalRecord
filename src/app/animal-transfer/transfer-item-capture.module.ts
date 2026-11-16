import { DynamicModule, Module, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemHistoricalCopyObserver } from '../../context/animal-transfer/application/item-historical-copy-observer';
import { ItemManifestObserver } from '../../context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../context/animal-transfer/application/item-manifest-preparer';
import { ItemSourceObservationPreparer } from '../../context/animal-transfer/application/item-source-observation-preparer';
import { TransferItemCapture } from '../../context/animal-transfer/application/transfer-item-capture';
import { OwnershipArchiveCapture } from '../../context/animal-transfer/application/ownership-archive-capture';
import type { OwnershipArchiveStorage } from '../../context/animal-transfer/domain/ownership-archive';
import type { ItemCaptureStore } from '../../context/animal-transfer/domain/transfer-item-capture';
import type {
  ItemFixedSourceReader,
  ItemHistoricalObjectReader,
  ItemSourceProfileReader,
  ItemSourceRetentionReader,
} from '../../context/animal-transfer/domain/transfer-item-historical-observation';
import {
  MongoTransferItemCapture,
  type SourceProfileConfirmation,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
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

type CaptureSourceEvidence = Readonly<{
  reader: ItemSourceRetentionReader & ItemFixedSourceReader;
  profiles: ItemSourceProfileReader & SourceProfileConfirmation['profiles'];
  expectedBucketOwner: string;
  now: () => Date;
}>;

/** Explicit provider composition only. Not imported by the app; no SDK/bootstrap/worker. */
@Module({})
export class TransferItemCaptureModule {
  static register(
    capture: Pick<OwnershipArchiveCapture, 'captureBatch'>,
    manifestKeys?: Pick<OwnershipArchiveStorage, 'keyFromUrl'>,
    sourceReader?: ItemHistoricalObjectReader,
    sourceEvidence?: CaptureSourceEvidence,
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

    const preparationProviders: Provider[] = [];
    const preparationExports = [];
    const evidence = sourceEvidence && Object.freeze({ ...sourceEvidence });
    if (sourceEvidence !== undefined) {
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
      const { profiles, now } = evidence;
      preparationProviders.push({
        provide: 'ItemSourceProfileConfirmation',
        useValue: Object.freeze({
          profiles,
          now,
        }) satisfies SourceProfileConfirmation,
      });
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
