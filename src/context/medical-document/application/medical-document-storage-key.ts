import {
  MedicalDocumentLocation,
  MedicalDocumentType,
} from '../domain/medical-document';

const CATEGORY_SLUGS: Record<MedicalDocumentType, string> = {
  [MedicalDocumentType.Prescription]: 'prescriptions',
  [MedicalDocumentType.MedicalOrder]: 'medical-orders',
  [MedicalDocumentType.Referral]: 'referrals',
  [MedicalDocumentType.VaccinationCard]: 'vaccination-cards',
  [MedicalDocumentType.ClinicalHistory]: 'clinical-histories',
  [MedicalDocumentType.DiagnosticImage]: 'diagnostic-images',
  [MedicalDocumentType.LaboratoryResult]: 'laboratory-results',
  [MedicalDocumentType.Other]: 'other',
};

export function buildMedicalDocumentIntakeStorageKey(
  ownerId: string,
  documentId: string,
  sourceFileName: string,
): string {
  return `users/${ownerId}/medical-document-intake/${documentId}/${sourceFileName}`;
}

export function buildMedicalDocumentAnalysisOutputStorageKey(
  ownerId: string,
  documentId: string,
): string {
  return `users/${ownerId}/medical-document-intake/${documentId}/analysis-output/`;
}

export function buildMedicalDocumentImageAnalysisOutputStorageKey(
  ownerId: string,
  documentId: string,
): string {
  return `${buildMedicalDocumentAnalysisOutputStorageKey(ownerId, documentId)}image/`;
}

export function buildMedicalDocumentDocumentAnalysisOutputStorageKey(
  ownerId: string,
  documentId: string,
): string {
  return `${buildMedicalDocumentAnalysisOutputStorageKey(ownerId, documentId)}document/`;
}

export function buildMedicalDocumentAnalysisInputStorageKey(
  ownerId: string,
  documentId: string,
): string {
  return `users/${ownerId}/medical-document-intake/${documentId}/analysis-input.pdf`;
}

export function buildMedicalDocumentLocations(
  ownerId: string,
  animalIds: string[],
  category: MedicalDocumentType,
  documentId: string,
  sourceFileName: string,
): MedicalDocumentLocation[] {
  const categorySlug = CATEGORY_SLUGS[category];
  return [...new Set(animalIds)].map((animalId) => ({
    animalId,
    storageKey: `users/${ownerId}/animals/${animalId}/medical-documents/${categorySlug}/${documentId}/${sourceFileName}`,
  }));
}

export function buildLegacyMedicalDocumentStorageKeys(
  ownerId: string,
  animalIds: string[],
  documentId: string,
  sourceFileName: string,
): string[] {
  return [...new Set(animalIds)].map(
    (animalId) =>
      `users/${ownerId}/animals/${animalId}/medical-documents/${documentId}/${sourceFileName}`,
  );
}

export function getMedicalDocumentSourceFileName(storageKey: string): string {
  return storageKey.slice(storageKey.lastIndexOf('/') + 1);
}
