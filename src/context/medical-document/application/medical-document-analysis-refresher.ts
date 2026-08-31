import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentStatus,
  MedicalDocumentType,
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
  buildMedicalDocumentDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentImageAnalysisOutputStorageKey,
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
      document.analysisOutputUri || this.initialOutputUri(document);
    let invocationArn = document.analysisInvocationArn;

    if (!invocationArn) {
      const inputStorageKey = this.isImageAnalysisStage(document, outputS3Uri)
        ? document.temporaryStorageKey || document.storageKey
        : requiresPdfAnalysisInput(document.mimeType)
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
      if (this.isImageAnalysisStage(document, outputS3Uri)) {
        await this.startDocumentFallback(document);
        return document;
      }
      document.fail(result.failureReason);
      await this.repository.update(document);
      return document;
    }

    if (
      this.isImageAnalysisStage(document, outputS3Uri) &&
      !result.analysis.detectedCategories.some(
        (detection) =>
          detection.category === MedicalDocumentType.DiagnosticImage,
      )
    ) {
      await this.startDocumentFallback(document);
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

  private initialOutputUri(document: MedicalDocument): string {
    const outputKey = requiresPdfAnalysisInput(document.mimeType)
      ? buildMedicalDocumentImageAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        )
      : buildMedicalDocumentAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        );
    return this.storage.objectUri(outputKey);
  }

  private isImageAnalysisStage(
    document: MedicalDocument,
    outputS3Uri: string,
  ): boolean {
    if (!requiresPdfAnalysisInput(document.mimeType)) return false;
    return (
      outputS3Uri ===
      this.storage.objectUri(
        buildMedicalDocumentImageAnalysisOutputStorageKey(
          document.ownerId,
          document.id,
        ),
      )
    );
  }

  private async startDocumentFallback(
    document: MedicalDocument,
  ): Promise<void> {
    const inputS3Uri = this.storage.objectUri(
      buildMedicalDocumentAnalysisInputStorageKey(
        document.ownerId,
        document.id,
      ),
    );
    const outputS3Uri = this.storage.objectUri(
      buildMedicalDocumentDocumentAnalysisOutputStorageKey(
        document.ownerId,
        document.id,
      ),
    );
    const invocationArn = await this.analyzer.start(
      inputS3Uri,
      outputS3Uri,
      `${document.id}-document-fallback`,
    );
    document.registerAnalysisJob(invocationArn, outputS3Uri);
    await this.repository.update(document);
  }
}
