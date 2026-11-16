import { MediaConfirmationContext } from './media-confirmation-context';

export const ANIMAL_MEDIA_PROMOTION_CONFIRMATION =
  'AnimalMediaPromotionConfirmation';
export type PromotionConfirmationCall = {
  scope: MediaConfirmationContext;
  uploadId: string;
  effectId: string;
  dispatcherInstanceId: string;
  observationId: string;
};
/** Backend-only correlation, not a persisted receipt or a permission to replay. */
export type PromotionConfirmationReceipt = Readonly<{
  operationId: string;
  instanceId: string;
  animalId: string;
  uploadId: string;
  effectId: string;
  dispatcherInstanceId: string;
  observationId: string;
}>;
export interface AnimalMediaPromotionConfirmation {
  confirm(input: PromotionConfirmationCall): Promise<void>;
}
