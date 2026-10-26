import { readLocalMongoTestSettings } from './local-mongo-test-safety';

export default function requireLocalMongo(): void {
  readLocalMongoTestSettings(process.env);
}
