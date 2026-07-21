import { Inject, Injectable } from '@nestjs/common';
import { MedicalDocumentStatus } from '../domain/medical-document';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { MedicalDocumentFinder } from './medical-document-finder';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

@Injectable()
export class MedicalDocumentDownloader {
  constructor(
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    private readonly finder: MedicalDocumentFinder,
  ) {}

  async run(
    documentId: string,
    ownerId: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const document = await this.finder.findById(documentId, ownerId);
    if (document.status !== MedicalDocumentStatus.Accepted) {
      throw new ConflictError(
        'Only accepted medical documents can be downloaded',
      );
    }

    const downloadUrl = await this.storage.generateDownloadUrl(
      document.storageKey,
      document.originalFileName,
    );
    return { downloadUrl, expiresIn: 300 };
  }
}
