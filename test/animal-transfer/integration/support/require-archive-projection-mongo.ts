import { readArchiveProjectionMongoSettings } from './archive-projection-mongo-safety';

export default function requireArchiveProjectionMongo(): void {
  readArchiveProjectionMongoSettings(process.env);
}
