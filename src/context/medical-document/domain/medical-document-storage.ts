export interface MedicalDocumentStorage {
  putObject(
    key: string,
    content: Uint8Array,
    mimeType: string,
  ): Promise<string>;
  deleteObject(key: string): Promise<void>;
  generateDownloadUrl(key: string, downloadFileName: string): Promise<string>;
}
