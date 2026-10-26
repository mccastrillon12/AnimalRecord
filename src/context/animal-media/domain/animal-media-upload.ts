export type MediaRevision = { etag: string; size: number; versionId?: string };
export type PinnedMedia = MediaRevision & { sha256: string };
export type AnimalMediaUpload = {
  id: string;
  ownerId: string;
  animalId: string;
  finalKey: string;
  stagingKey: string;
  mimeType: string;
  size: number;
  createdAt: string;
  pinned?: PinnedMedia;
  sealed?: MediaRevision;
  legacy?: {
    migrationId: string;
    sourceUrl: string;
    kind: 'PROFILE' | 'DIARY';
    entryId?: string;
    attachmentId?: string;
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
  describeSource(key: string): Promise<{ mimeType: string; size: number }>;
  pinSource(upload: AnimalMediaUpload): Promise<PinnedMedia>;
  promote(upload: AnimalMediaUpload): Promise<MediaRevision>;
  verifyFinal(upload: AnimalMediaUpload): Promise<MediaRevision>;
}

export const isDirectAnimalMediaKey = (key: string): boolean =>
  /^users\/[^/]+\/animals\/[^/]+\/(profile_[^/]+|diary\/)/.test(key);

/** Reserved until a fenced transferred-media registry/publication protocol exists. */
export const isReservedArchiveGenerationKey = (key: string): boolean =>
  /^users\/[^/]+\/animals\/[^/]+\/profile_000\d{78}\.(jpeg|png|webp)$/.test(
    key,
  ) || key.split('/').includes('transfer-generations');
