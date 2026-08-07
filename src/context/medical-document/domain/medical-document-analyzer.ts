import {
  MedicalDocumentDetectedCategory,
  MedicalDocumentExtractionsByCategory,
  MedicalDocumentProviderMetadata,
  MedicalDocumentType,
} from './medical-document';

export type MedicalDocumentAnalysis = {
  primaryDetectedCategory?: MedicalDocumentType;
  detectedCategories: MedicalDocumentDetectedCategory[];
  extractionsByCategory: MedicalDocumentExtractionsByCategory;
  providerMetadata: MedicalDocumentProviderMetadata;
};

export enum MedicalDocumentAnalysisJobStatus {
  InProgress = 'IN_PROGRESS',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
}

export type MedicalDocumentAnalysisJobResult =
  | { status: MedicalDocumentAnalysisJobStatus.InProgress }
  | {
      status: MedicalDocumentAnalysisJobStatus.Succeeded;
      analysis: MedicalDocumentAnalysis;
    }
  | {
      status: MedicalDocumentAnalysisJobStatus.Failed;
      failureReason: string;
    };

export interface MedicalDocumentAnalyzer {
  start(
    inputS3Uri: string,
    outputS3Uri: string,
    clientToken: string,
  ): Promise<string>;
  getResult(
    invocationArn: string,
    outputS3Uri: string,
  ): Promise<MedicalDocumentAnalysisJobResult>;
}
