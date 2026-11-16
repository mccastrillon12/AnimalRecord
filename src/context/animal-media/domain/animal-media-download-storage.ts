export interface AnimalMediaDownload {
  downloadUrl: string;
  expiresIn: number;
}

export interface AnimalMediaDownloadStorage {
  getFileKey(fileUrl: string): string | undefined;
  signAnimalMediaDownload(key: string): Promise<AnimalMediaDownload>;
}
