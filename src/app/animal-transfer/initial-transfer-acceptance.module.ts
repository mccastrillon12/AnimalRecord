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
    } = options;
    const keyFromUrl = urls.keyFromUrl.bind(urls);
    return {
      module: InitialTransferAcceptanceModule,
      imports: [
        TransferAcceptanceStartModule.register(urls),
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
      ],
      providers: [
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
              sourceEvidence.now,
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
