import { MediaPromotionScope, promotionId } from './media-promotion-effect';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

/** Correlation only. Never a dispatch grant or proof of a current journal fence. */
export type MediaConfirmationContext = Readonly<MediaPromotionScope>;
export const MEDIA_CONFIRMATION_JOURNAL_PROTOCOL = 'MEDIA_PROMOTION_ROWS_V1';

/** Copy before any await; reject cross-operation retargeting and extra payload. */
export function mediaConfirmationContext(
  input: MediaConfirmationContext,
  expected?: {
    animalId: string;
    ownerId?: string;
    kind: MediaPromotionScope['kind'];
  },
): MediaConfirmationContext {
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'animalId,instanceId,kind,operationId,ownerId,ownershipVersion' ||
    !['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'].includes(input.kind) ||
    !Number.isSafeInteger(input.ownershipVersion) ||
    input.ownershipVersion < 1 ||
    (expected &&
      (input.animalId !== expected.animalId ||
        input.kind !== expected.kind ||
        (expected.ownerId !== undefined && input.ownerId !== expected.ownerId)))
  )
    throw new InvalidArgumentError('Invalid media confirmation context');
  return Object.freeze({
    operationId: promotionId(input.operationId),
    instanceId: promotionId(input.instanceId),
    animalId: promotionId(input.animalId),
    ownerId: promotionId(input.ownerId),
    ownershipVersion: input.ownershipVersion,
    kind: input.kind,
  });
}
