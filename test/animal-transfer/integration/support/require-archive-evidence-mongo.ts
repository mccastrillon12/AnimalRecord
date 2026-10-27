import { readArchiveEvidenceMongoSettings } from './archive-evidence-mongo-safety';

export default function requireArchiveEvidenceMongo(): void {
  readArchiveEvidenceMongoSettings(process.env);
}
