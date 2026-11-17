import { DynamicModule, Module } from '@nestjs/common';
import { PublishedOwnershipHistoryDownloader } from '../../context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../context/animal-transfer/application/published-ownership-history-reader';
import type { ArchiveProjectionUrls } from '../../context/animal-transfer/domain/ownership-archive-recipient-projection';
import type {
  PublishedOwnershipHistorySource,
  PublishedHistoryVersionSource,
} from '../../context/animal-transfer/domain/published-ownership-history';
import type { InitialPutConfiguration } from '../../context/animal-transfer/infrastructure/storage/initial-item-put-preparation';
import { TransferAcceptanceStartModule } from './transfer-acceptance-start.module';
import { TransferItemCaptureModule } from './transfer-item-capture.module';
import { InitialTransferAcceptanceResumer } from './initial-transfer-acceptance-resumer';
import {
  TRANSFER_ACCEPTANCE_PROGRESS,
  type TransferAcceptanceProgress,
} from '../../context/animal-transfer/application/transfer-acceptance-execution';
import type { MongoTransferItemCapture } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import type { DirectTransferStorage } from '../../context/animal-transfer/application/direct-transfer-item-progress';

type CaptureProviders = Parameters<typeof TransferItemCaptureModule.register>;
type InitialAcceptanceProviders = Readonly<{
  capture: CaptureProviders[0];
  urls: ArchiveProjectionUrls;
  sourceReader: NonNullable<CaptureProviders[2]>;
  sourceEvidence: NonNullable<CaptureProviders[3]>;
  putEvidence: NonNullable<CaptureProviders[4]>;
  stableCut: NonNullable<CaptureProviders[5]>;
  ownershipSource: NonNullable<CaptureProviders[6]>;
  put: InitialPutConfiguration;
  historyVersions: ConstructorParameters<
    typeof PublishedOwnershipHistoryDownloader
  >[1];
  historyDownloadTimeoutMs: number;
  backgroundResume?: true;
}>;

export type InitialTransferAcceptanceConfiguration = Omit<
  InitialAcceptanceProviders,
  'capture' | 'ownershipSource' | 'sourceEvidence'
> & {
  sourceEvidence: Omit<
    InitialAcceptanceProviders['sourceEvidence'],
    'profiles'
  >;
};

/** Composes the same app with explicit storage and independent evidence providers. */
@Module({})
export class InitialTransferAcceptanceModule {
  static forDirectS3(
    urls: ArchiveProjectionUrls,
    copies: DirectTransferStorage,
    versions: InitialAcceptanceProviders['historyVersions'],
    timeoutMs: number,
  ): DynamicModule {
    return this.withCapture(
      urls,
      TransferItemCaptureModule.register(
        'application',
        urls,
        undefined,
        undefined,
        undefined,
        undefined,
        'application',
        undefined,
        copies,
      ),
      versions,
      timeoutMs,
      () => new Date(),
      true,
    );
  }

  static forApplication(
    options: InitialTransferAcceptanceConfiguration,
  ): DynamicModule {
    return this.register({
      ...options,
      capture: 'application',
      ownershipSource: 'application',
      sourceEvidence: { ...options.sourceEvidence, profiles: 'application' },
    });
  }

  static register(options: InitialAcceptanceProviders): DynamicModule {
    const {
      capture,
      urls,
      sourceReader,
      sourceEvidence,
      putEvidence,
      stableCut,
      ownershipSource,
      put,
      historyVersions,
      historyDownloadTimeoutMs,
      backgroundResume,
    } = options;
    return this.withCapture(
      urls,
      TransferItemCaptureModule.register(
        capture,
        urls,
        sourceReader,
        sourceEvidence,
        putEvidence,
        stableCut,
        ownershipSource,
        put,
      ),
      historyVersions,
      historyDownloadTimeoutMs,
      sourceEvidence.now,
      backgroundResume,
    );
  }

  private static withCapture(
    urls: ArchiveProjectionUrls,
    capture: DynamicModule,
    historyVersions: InitialAcceptanceProviders['historyVersions'],
    historyDownloadTimeoutMs: number,
    now: () => Date,
    backgroundResume?: true,
  ): DynamicModule {
    const keyFromUrl = urls.keyFromUrl.bind(urls);
    return {
      module: InitialTransferAcceptanceModule,
      imports: [TransferAcceptanceStartModule.register(urls), capture],
      providers: [
        ...(backgroundResume
          ? [
              {
                provide: InitialTransferAcceptanceResumer,
                inject: ['ItemCopyRecordStore', TRANSFER_ACCEPTANCE_PROGRESS],
                useFactory: (
                  store: MongoTransferItemCapture,
                  progress: TransferAcceptanceProgress,
                ) => new InitialTransferAcceptanceResumer(store, progress),
              },
            ]
          : []),
        {
          provide: PublishedOwnershipHistoryReader,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: PublishedOwnershipHistorySource) =>
            new PublishedOwnershipHistoryReader(store, keyFromUrl),
        },
        {
          provide: PublishedOwnershipHistoryDownloader,
          inject: ['ItemCopyRecordStore'],
          useFactory: (store: PublishedHistoryVersionSource) =>
            new PublishedOwnershipHistoryDownloader(
              store,
              historyVersions,
              keyFromUrl,
              historyDownloadTimeoutMs,
              now,
            ),
        },
      ],
      exports: [
        TransferAcceptanceStartModule,
        TransferItemCaptureModule,
        PublishedOwnershipHistoryReader,
        PublishedOwnershipHistoryDownloader,
      ],
    };
  }
}
