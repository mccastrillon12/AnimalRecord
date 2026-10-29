import { HttpStatus } from '@nestjs/common';
import { MediaPromotionConfirmationError } from '../../context/animal-media/application/media-promotion-confirmation';

/** Public error body excludes internal stages, IDs, raw causes and provider metadata. */
export function mediaPromotionHttpError(
  error: MediaPromotionConfirmationError,
): {
  status: HttpStatus;
  message: string;
} {
  if (error.reason === 'CONFLICT')
    return {
      status: HttpStatus.CONFLICT,
      message: 'The media confirmation changed; refresh before confirming',
    };
  if (error.reason === 'UNCERTAIN')
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'The media confirmation outcome is uncertain',
    };
  if (error.stage === 'INSPECT' || error.stage === 'VERIFY')
    return {
      status: HttpStatus.BAD_GATEWAY,
      message: 'The media destination could not be verified',
    };
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
  };
}
