import { readPromotionConfirmMongoSettings } from './media-promotion-confirm-mongo-safety';
export default function requirePromotionConfirmMongo(): void {
  readPromotionConfirmMongoSettings(process.env);
}
