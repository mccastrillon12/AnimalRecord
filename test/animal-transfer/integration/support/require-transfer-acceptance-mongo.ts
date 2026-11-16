import { readAcceptanceMongoSettings } from './transfer-acceptance-mongo-safety';
export default function requireAcceptanceMongo() {
  readAcceptanceMongoSettings(process.env);
}
