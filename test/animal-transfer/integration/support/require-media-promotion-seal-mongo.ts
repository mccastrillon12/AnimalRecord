import { readPromotionSealMongoSettings } from './media-promotion-seal-mongo-safety';
export default function requirePromotionSealMongo(): void {
  readPromotionSealMongoSettings(process.env);
}
