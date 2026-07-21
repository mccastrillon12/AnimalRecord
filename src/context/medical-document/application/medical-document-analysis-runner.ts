import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { MedicalDocument } from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { MedicalDocumentAnalyzer } from '../domain/medical-document-analyzer';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
};

export type MedicalDocumentUpload = {
  originalFileName: string;
  mimeType: string;
  size: number;
  content: Uint8Array;
};

@Injectable()
export class MedicalDocumentAnalysisRunner {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    @Inject('MedicalDocumentAnalyzer')
    private readonly analyzer: MedicalDocumentAnalyzer,
    private readonly animalAccess: MedicalDocumentAnimalAccess,
  ) {}

  async run(
    ownerId: string,
    animalIds: string[],
    file: MedicalDocumentUpload,
  ): Promise<MedicalDocument> {
    this.validateFile(file);
    await this.animalAccess.findOwnedAnimals(animalIds, ownerId);

    const documentId = uuidv4();
    const extension = ALLOWED_MIME_TYPES[file.mimeType];
    const storageKey = `users/${ownerId}/medical-documents/${documentId}/source.${extension}`;
    const document = MedicalDocument.create(
      ownerId,
      animalIds,
      file.originalFileName,
      file.mimeType,
      file.size,
      storageKey,
      documentId,
    );

    await this.repository.save(document);

    try {
      const s3Uri = await this.storage.putObject(
        storageKey,
        file.content,
        file.mimeType,
      );
      document.markAnalyzing();
      await this.repository.update(document);

      const analysis = await this.analyzer.analyze(s3Uri);
      document.completeAnalysis(analysis.extraction, analysis.providerMetadata);
      await this.repository.update(document);
      return document;
    } catch (error) {
      document.fail(
        error instanceof Error ? error.message : 'Unknown analysis error',
      );
      await this.repository.update(document);
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
  }

  private validateFile(file: MedicalDocumentUpload): void {
    if (!file.content.length || file.size <= 0) {
      throw new InvalidArgumentError('The document file is empty');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new InvalidArgumentError('The document cannot exceed 10 MB');
    }
    if (!ALLOWED_MIME_TYPES[file.mimeType]) {
      throw new InvalidArgumentError(
        'Only PDF, JPEG, PNG and TIFF documents are supported',
      );
    }
    if (!this.matchesFileSignature(file.content, file.mimeType)) {
      throw new InvalidArgumentError(
        'The file content does not match its declared type',
      );
    }
  }

  private matchesFileSignature(content: Uint8Array, mimeType: string): boolean {
    const bytes = Array.from(content.slice(0, 8));
    if (mimeType === 'application/pdf') {
      return bytes
        .slice(0, 5)
        .every(
          (value, index) => value === [0x25, 0x50, 0x44, 0x46, 0x2d][index],
        );
    }
    if (mimeType === 'image/jpeg') {
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (mimeType === 'image/png') {
      return bytes.every(
        (value, index) =>
          value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index],
      );
    }
    if (mimeType === 'image/tiff') {
      const littleEndian = [0x49, 0x49, 0x2a, 0x00];
      const bigEndian = [0x4d, 0x4d, 0x00, 0x2a];
      return (
        bytes
          .slice(0, 4)
          .every((value, index) => value === littleEndian[index]) ||
        bytes.slice(0, 4).every((value, index) => value === bigEndian[index])
      );
    }
    return false;
  }
}
