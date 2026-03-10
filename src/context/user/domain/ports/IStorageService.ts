export interface IStorageService {
    /**
     * Generates a pre-signed URL for a client to upload a file directly to the storage bucket.
     * @param fileName The desired path and filename in the bucket
     * @param mimeType The content type (e.g., 'image/jpeg')
     * @param maxSizeLimit Size limit in bytes
     * @returns The pre-signed upload URL and the final URL where the asset will be accessible after successful upload.
     */
    generatePreSignedUploadUrl(fileName: string, mimeType: string, maxSizeLimit: number): Promise<{ uploadUrl: string, finalUrl: string }>;

    /**
     * Deletes a file from the storage bucket given its final URL.
     * @param fileUrl The full URL of the file to delete
     */
    deleteFile(fileUrl: string): Promise<void>;
}
