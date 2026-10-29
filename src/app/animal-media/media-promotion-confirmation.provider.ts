import { FactoryProvider } from '@nestjs/common';
import {
  ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
  AnimalMediaPromotionConfirmation,
} from '../../context/animal-media/domain/media-promotion-confirmation-runner';
import { AwsPromotionConfirmationConfig } from '../../context/animal-media/infrastructure/aws-media-promotion-confirmation';
import {
  MediaPromotionAssemblyError,
  prepareMediaPromotionConfirmation,
  PromotionMongoBinding,
} from '../../context/animal-media/infrastructure/prepare-media-promotion-confirmation';

export const MEDIA_PROMOTION_MONGO_BINDING = 'MediaPromotionMongoBinding';
export type PromotionConfirmationSelection =
  | { mode: 'CURRENT' }
  | {
      mode: 'PROMOTION_ROWS_V1';
      expectedDatabaseName: string;
      aws: AwsPromotionConfirmationConfig;
    };

/** Prepared backend provider. Not registered in any current module; no environment switch. */
export function preparePromotionConfirmationProvider(
  raw: PromotionConfirmationSelection,
): FactoryProvider<AnimalMediaPromotionConfirmation | undefined> {
  try {
    if (raw?.mode === 'CURRENT' && Object.keys(raw).join(',') === 'mode')
      return {
        provide: ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
        inject: [],
        useFactory: () => undefined,
      };
    if (
      raw?.mode !== 'PROMOTION_ROWS_V1' ||
      Object.keys(raw).sort().join(',') !== 'aws,expectedDatabaseName,mode' ||
      typeof raw.expectedDatabaseName !== 'string' ||
      !raw.expectedDatabaseName ||
      !raw.aws
    )
      throw new Error();
    const expected = raw.expectedDatabaseName;
    const config = Object.freeze({
      ...raw.aws,
      credentials:
        typeof raw.aws.credentials === 'function'
          ? raw.aws.credentials
          : Object.freeze({ ...raw.aws.credentials }),
    });
    return {
      provide: ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
      inject: [MEDIA_PROMOTION_MONGO_BINDING],
      useFactory: (binding: PromotionMongoBinding) =>
        prepareMediaPromotionConfirmation(binding, expected, config),
    };
  } catch {
    throw new MediaPromotionAssemblyError('CONFIGURATION');
  }
}
