export interface AnimalMediaDownload {
  downloadUrl: string;
  expiresIn: number;
}

export interface AnimalMediaDownloadStorage {
  getFileKey(fileUrl: string): string | undefined;
  signAnimalMediaDownload(key: string): Promise<AnimalMediaDownload>;
}

export function animalProfilePictureKey(
  storage: Pick<AnimalMediaDownloadStorage, 'getFileKey'>,
  ownerId: string,
  animalId: string,
  photoUrl?: string,
): string | undefined {
  if (!photoUrl) return undefined;
  const key = storage.getFileKey(photoUrl);
  const prefix = `users/${ownerId}/animals/${animalId}/`;
  return key?.startsWith(prefix) &&
    /^profile_\d+\.(jpeg|png|webp)$/.test(key.slice(prefix.length))
    ? key
    : undefined;
}
