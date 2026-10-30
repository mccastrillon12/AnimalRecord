import { readTransferFlowMongoSettings } from './transfer-flow-mongo-safety';
export default function requireTransferFlowMongo(): void {
  readTransferFlowMongoSettings(process.env);
}
