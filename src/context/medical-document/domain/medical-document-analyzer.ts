import {
  MedicalDocumentExtraction,
  MedicalDocumentProviderMetadata,
} from './medical-document';

export type MedicalDocumentAnalysis = {
  extraction: MedicalDocumentExtraction;
  providerMetadata: MedicalDocumentProviderMetadata;
};

export interface MedicalDocumentAnalyzer {
  analyze(s3Uri: string): Promise<MedicalDocumentAnalysis>;
}
