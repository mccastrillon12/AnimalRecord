import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import {
  MediaPromotionConfirmation,
  PromotionConfirmationInput,
} from '../application/media-promotion-confirmation';
import { MediaPromotionPersistence } from '../domain/media-promotion-persistence';
import { MediaPromotionSealingPersistence } from '../domain/media-promotion-sealing';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { AwsMediaPromotionDestinationReader } from './aws-media-promotion-destination-reader';
import { MediaPromotionCopyDispatcher } from './media-promotion-copy-dispatcher';
import { AnimalMediaPromotionConfirmation } from '../domain/media-promotion-confirmation-runner';

export type AwsPromotionConfirmationConfig = {
  bucket: string;
  region: string;
  credentials: NonNullable<S3ClientConfig['credentials']>;
  maxAttempts?: number;
};

/** Explicit backend assembly. No environment, Nest activation or index installation. */
export class AwsMediaPromotionConfirmation implements AnimalMediaPromotionConfirmation {
  private readonly config: AwsPromotionConfirmationConfig;

  constructor(
    private readonly persistence: MediaPromotionPersistence &
      MediaPromotionSealingPersistence,
    raw: AwsPromotionConfirmationConfig,
  ) {
    if (
      !raw ||
      Object.keys(raw).some(
        (k) => !['bucket', 'region', 'credentials', 'maxAttempts'].includes(k),
      ) ||
      typeof raw.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(raw.bucket) ||
      typeof raw.region !== 'string' ||
      !/^(?:us|eu|ap|sa|ca|me|af|il|mx)-(?!gov-)[a-z]+-\d+$/.test(raw.region) ||
      !raw.credentials ||
      (typeof raw.credentials !== 'function' &&
        (typeof raw.credentials.accessKeyId !== 'string' ||
          !raw.credentials.accessKeyId ||
          typeof raw.credentials.secretAccessKey !== 'string' ||
          !raw.credentials.secretAccessKey ||
          (raw.credentials.sessionToken !== undefined &&
            typeof raw.credentials.sessionToken !== 'string'))) ||
      (raw.maxAttempts !== undefined &&
        (!Number.isSafeInteger(raw.maxAttempts) || raw.maxAttempts < 1))
    )
      throw new InvalidArgumentError('Invalid promotion runtime configuration');
    const credentials = raw.credentials;
    this.config = Object.freeze({
      bucket: raw.bucket,
      region: raw.region,
      credentials:
        typeof credentials === 'function'
          ? async () => ({ ...(await credentials()) })
          : Object.freeze({ ...credentials }),
      maxAttempts: raw.maxAttempts ?? 3,
    });
  }

  async confirm(
    input: Omit<PromotionConfirmationInput, 'bucket'>,
  ): Promise<void> {
    const config = this.config;
    const client = new S3Client({
      region: config.region,
      endpoint: `https://s3.${config.region}.amazonaws.com`,
      // The SDK annotates credential objects. Keep our captured snapshot private.
      credentials:
        typeof config.credentials === 'function'
          ? config.credentials
          : { ...config.credentials },
      maxAttempts: config.maxAttempts,
      retryMode: 'standard',
      defaultsMode: 'standard',
      followRegionRedirects: false,
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      useArnRegion: false,
      disableS3ExpressSessionAuth: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    try {
      const cycle = new MediaPromotionConfirmation(
        this.persistence,
        new AwsMediaPromotionDestinationReader(client),
        {
          create: (identity) =>
            MediaPromotionCopyDispatcher.create(this.persistence, {
              ...identity,
              credentials: config.credentials,
              regions: [config.region],
              maxAttempts: config.maxAttempts,
              followRegionRedirects: false,
            }),
        },
      );
      await cycle.confirm({ ...input, bucket: config.bucket });
    } finally {
      client.destroy();
    }
  }
}
