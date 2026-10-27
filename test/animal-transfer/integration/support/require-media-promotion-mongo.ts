import { readMediaPromotionMongoSettings } from './media-promotion-mongo-safety';

export default function requireMediaPromotionMongo(): void {
  readMediaPromotionMongoSettings(process.env);
}
