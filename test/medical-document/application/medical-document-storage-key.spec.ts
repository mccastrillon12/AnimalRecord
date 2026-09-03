import {
  buildMedicalDocumentAnalysisInputStorageKey,
  buildMedicalDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentImageAnalysisOutputStorageKey,
  buildMedicalDocumentIntakeStorageKey,
  buildMedicalDocumentLocations,
  buildMedicalDocumentPdfRescueInputStorageKey,
  buildMedicalDocumentPdfRescueOutputStorageKey,
} from '../../../src/context/medical-document/application/medical-document-storage-key';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';

describe('Medical document storage keys', () => {
  const ownerId = 'owner-id';
  const animalId = 'animal-id';
  const documentId = 'document-id';

  it('builds a single owner-scoped intake key', () => {
    expect(
      buildMedicalDocumentIntakeStorageKey(ownerId, documentId, 'source.pdf'),
    ).toBe('users/owner-id/medical-document-intake/document-id/source.pdf');
  });

  it('keeps BDA output under the temporary document prefix', () => {
    expect(
      buildMedicalDocumentAnalysisOutputStorageKey(ownerId, documentId),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-output/',
    );
  });

  it('builds a deterministic temporary PDF input for raster analysis', () => {
    expect(
      buildMedicalDocumentAnalysisInputStorageKey(ownerId, documentId),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-input.pdf',
    );
  });

  it('separates IMAGE routing output from DOCUMENT fallback output', () => {
    expect(
      buildMedicalDocumentImageAnalysisOutputStorageKey(ownerId, documentId),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-output/image/',
    );
    expect(
      buildMedicalDocumentDocumentAnalysisOutputStorageKey(ownerId, documentId),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-output/document/',
    );
  });

  it('separates temporary PDF rescue pages and their BDA output', () => {
    expect(
      buildMedicalDocumentPdfRescueInputStorageKey(ownerId, documentId, 3),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-output/pdf-rescue/input/page-3.jpg',
    );
    expect(
      buildMedicalDocumentPdfRescueOutputStorageKey(ownerId, documentId, 3),
    ).toBe(
      'users/owner-id/medical-document-intake/document-id/analysis-output/pdf-rescue/output/page-3/',
    );
  });

  it.each([
    [MedicalDocumentType.Prescription, 'prescriptions'],
    [MedicalDocumentType.MedicalOrder, 'medical-orders'],
    [MedicalDocumentType.Referral, 'referrals'],
    [MedicalDocumentType.VaccinationCard, 'vaccination-cards'],
    [MedicalDocumentType.ClinicalHistory, 'clinical-histories'],
    [MedicalDocumentType.DiagnosticImage, 'diagnostic-images'],
    [MedicalDocumentType.LaboratoryResult, 'laboratory-results'],
    [MedicalDocumentType.Other, 'other'],
  ])('maps %s to the %s final folder', (category, slug) => {
    expect(
      buildMedicalDocumentLocations(
        ownerId,
        [animalId, animalId],
        category,
        documentId,
        'source.pdf',
      ),
    ).toEqual([
      {
        animalId,
        storageKey: `users/${ownerId}/animals/${animalId}/medical-documents/${slug}/${documentId}/source.pdf`,
      },
    ]);
  });
});
