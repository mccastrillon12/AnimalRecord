import { AnimalMediaUpload } from './animal-media-upload';

export type MediaMigrationDefinition = {
  id: string;
  animalId: string;
  ownerId: string;
  ownershipVersion: number;
};
export type MediaMigration = MediaMigrationDefinition & {
  phase: 'PROFILE' | 'DIARY' | 'COMPLETED' | 'STOPPED';
  revision: number;
  reservationEpoch?: number;
  afterId?: string;
  recovery?: Omit<MediaMigrationStop, 'id'> & { stoppedAt: string };
};
export type MediaMigrationStop = {
  id: string;
  expectedRevision: number;
  requestId: string;
  operatorId: string;
  reason: 'SOURCE_REVISION_UNAVAILABLE' | 'OPERATOR_INTERVENTION';
  evidenceRef: string;
};
export type LegacyMediaReference = {
  kind: 'PROFILE' | 'DIARY';
  url: string;
  entryId?: string;
  attachmentId?: string;
  mimeType?: string;
  size?: number;
};
export type MediaReferenceChange = {
  before: LegacyMediaReference;
  afterUrl: string;
};
export type MigrationPage = {
  references: LegacyMediaReference[];
  next: Pick<MediaMigration, 'phase' | 'afterId'>;
};

export const mediaMigrationLockId = (id: string): string =>
  `media-migration:${id}`;

export interface LegacyMediaMigrationRepository {
  start(definition: MediaMigrationDefinition): Promise<MediaMigration>;
  find(id: string): Promise<MediaMigration | null>;
  stopForRecovery(input: MediaMigrationStop): Promise<MediaMigration>;
  readPage(job: MediaMigration, limit: number): Promise<MigrationPage>;
  commitPage(
    job: MediaMigration,
    page: MigrationPage,
    changes: MediaReferenceChange[],
  ): Promise<void>;
}
export interface LegacyMediaCopier {
  prepare(
    job: MediaMigration,
    reference: LegacyMediaReference,
  ): Promise<string>;
}

export function sameMigration(
  upload: AnimalMediaUpload,
  job: MediaMigration,
  ref: LegacyMediaReference,
): boolean {
  return (
    upload.ownerId === job.ownerId &&
    upload.animalId === job.animalId &&
    upload.legacy?.migrationId === job.id &&
    upload.legacy.sourceUrl === ref.url &&
    upload.legacy.kind === ref.kind &&
    upload.legacy.entryId === ref.entryId &&
    upload.legacy.attachmentId === ref.attachmentId
  );
}
