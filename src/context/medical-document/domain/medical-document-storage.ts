export interface MedicalDocumentStorage {
  putObject(
    key: string,
    content: Uint8Array,
    mimeType: string,
  ): Promise<string>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectUri(key: string): string;
  listJsonObjects(
    s3Uri: string,
  ): Promise<Array<{ key: string; content: string }>>;
  deletePrefix(s3Uri: string): Promise<void>;
  generateDownloadUrl(key: string, downloadFileName: string): Promise<string>;
}
