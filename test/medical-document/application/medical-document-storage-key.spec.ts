import {
  buildMedicalDocumentAnalysisOutputStorageKey,
  buildMedicalDocumentIntakeStorageKey,
  buildMedicalDocumentLocations,
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
