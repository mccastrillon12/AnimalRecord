import { readPromotionDispatchMongoSettings } from './media-promotion-dispatch-mongo-safety';

export default function requirePromotionDispatchMongo(): void {
  readPromotionDispatchMongoSettings(process.env);
}
