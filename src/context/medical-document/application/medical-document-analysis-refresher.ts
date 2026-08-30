import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentStatus,
} from '../domain/medical-document';
import {
  MedicalDocumentAnalysisJobStatus,
  MedicalDocumentAnalyzer,
} from '../domain/medical-document-analyzer';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import {
  buildMedicalDocumentAnalysisInputStorageKey,
  buildMedicalDocumentAnalysisOutputStorageKey,
} from './medical-document-storage-key';
import { requiresPdfAnalysisInput } from './medical-document-analysis-input';

@Injectable()
export class MedicalDocumentAnalysisRefresher {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    @Inject('MedicalDocumentAnalyzer')
    private readonly analyzer: MedicalDocumentAnalyzer,
  ) {}

  async refresh(document: MedicalDocument): Promise<MedicalDocument> {
    if (document.status !== MedicalDocumentStatus.Analyzing) return document;

    const outputS3Uri =
      document.analysisOutputUri ||
      this.storage.objectUri(
        buildMedicalDocumentAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        ),
      );
    let invocationArn = document.analysisInvocationArn;

    if (!invocationArn) {
      const inputStorageKey = requiresPdfAnalysisInput(document.mimeType)
        ? buildMedicalDocumentAnalysisInputStorageKey(
            document.ownerId,
            document.id,
          )
        : document.temporaryStorageKey || document.storageKey;
      const inputS3Uri = this.storage.objectUri(inputStorageKey);
      invocationArn = await this.analyzer.start(
        inputS3Uri,
        outputS3Uri,
        document.id,
      );
      document.registerAnalysisJob(invocationArn, outputS3Uri);
      await this.repository.update(document);
    }

    const result = await this.analyzer.getResult(invocationArn, outputS3Uri);
    if (result.status === MedicalDocumentAnalysisJobStatus.InProgress) {
      return document;
    }
    if (result.status === MedicalDocumentAnalysisJobStatus.Failed) {
      document.fail(result.failureReason);
      await this.repository.update(document);
      return document;
    }

    document.completeAnalysis(
      result.analysis.primaryDetectedCategory,
      result.analysis.detectedCategories,
      result.analysis.extractionsByCategory,
      result.analysis.providerMetadata,
    );
    await this.repository.update(document);
    return document;
  }
}
