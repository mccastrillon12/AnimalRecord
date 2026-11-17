export type MediaRevision = { etag: string; size: number; versionId?: string };
export type PinnedMedia = MediaRevision & { sha256: string };
export type MediaMigrationRetention = Readonly<{
  bucket?: string;
  expectedBucketOwner: string;
  retainUntil: string;
}>;

export function validMediaMigrationRetention(
  retention: MediaMigrationRetention | undefined,
  now = Date.now(),
): retention is MediaMigrationRetention {
  if (
    !retention ||
    typeof retention.expectedBucketOwner !== 'string' ||
    !/^\d{12}$/.test(retention.expectedBucketOwner) ||
    typeof retention.retainUntil !== 'string'
  )
    return false;
  const date = new Date(retention.retainUntil);
  return date.getTime() > now && date.toISOString() === retention.retainUntil;
}

export function versionedMedia(version: unknown): version is string {
  return (
    typeof version === 'string' &&
    !!version.trim() &&
    version.trim().toLowerCase() !== 'null'
  );
}

export function sameMediaMigrationRetention(
  left?: MediaMigrationRetention,
  right?: MediaMigrationRetention,
): boolean {
  return (
    left?.bucket === right?.bucket &&
    left?.expectedBucketOwner === right?.expectedBucketOwner &&
    left?.retainUntil === right?.retainUntil
  );
}

export type AnimalMediaUpload = {
  id: string;
  ownerId: string;
  animalId: string;
  finalKey: string;
  stagingKey: string;
  mimeType: string;
  size: number;
  createdAt: string;
  // Internal CAS fence only; absent on older tickets, never a dispatch capability.
  mediaPromotionRevision?: number;
  pinned?: PinnedMedia;
  sealed?: MediaRevision;
  legacy?: {
    migrationId: string;
    sourceUrl: string;
    kind: 'PROFILE' | 'DIARY' | 'MEDICAL_DOCUMENT';
    entryId?: string;
    attachmentId?: string;
    documentId?: string;
    documentVersion?: number;
    retention?: MediaMigrationRetention;
  };
};

export interface AnimalMediaUploadRepository {
  create(upload: AnimalMediaUpload): Promise<void>;
  find(finalKey: string): Promise<AnimalMediaUpload | null>;
  findLegacySource(sourceKey: string): Promise<AnimalMediaUpload | null>;
  pin(finalKey: string, source: PinnedMedia): Promise<AnimalMediaUpload>;
  seal(
    finalKey: string,
    sha256: string,
    revision: MediaRevision,
  ): Promise<void>;
}

export interface AnimalMediaUploadStorage {
  keyFromUrl(url: string): string | undefined;
  urlForKey(key: string): string;
  signStaging(upload: AnimalMediaUpload): Promise<string>;
  describeSource(
    key: string,
    expectedBucketOwner?: string,
  ): Promise<{ mimeType: string; size: number }>;
  pinSource(upload: AnimalMediaUpload): Promise<PinnedMedia>;
  promote(upload: AnimalMediaUpload): Promise<MediaRevision>;
  verifyFinal(
    upload: AnimalMediaUpload,
    expectedBucketOwner?: string,
  ): Promise<MediaRevision>;
  verifyMigrationRetention?(
    key: string,
    revision: MediaRevision,
    retention: MediaMigrationRetention,
  ): Promise<void>;
  hasRetainedMigrationSource?(
    key: string,
    expected: { mimeType: string; size: number },
    retention: MediaMigrationRetention,
  ): Promise<boolean>;
}

export const isDirectAnimalMediaKey = (key: string): boolean =>
  /^users\/[^/]+\/animals\/[^/]+\/(profile_[^/]+|diary\/)/.test(key);

/** Reserved until a fenced transferred-media registry/publication protocol exists. */
export const isReservedArchiveGenerationKey = (key: string): boolean =>
  /^users\/[^/]+\/animals\/[^/]+\/profile_000\d{78}\.(jpeg|png|webp)$/.test(
    key,
  ) || key.split('/').includes('transfer-generations');
