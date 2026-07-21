import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';

describe('MedicalDocument', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174000';
  const extraction: MedicalDocumentExtraction = {
    documentType: MedicalDocumentType.Prescription,
    patientHints: [],
    diagnoses: [{ id: 'diagnosis-1', name: 'Dermatitis' }],
    medications: [{ id: 'medication-1', name: 'Amoxicilina' }],
    vaccinations: [],
    medicalOrders: [],
    additionalFields: {},
    warnings: [],
  };

  function analyzedDocument(): MedicalDocument {
    const document = MedicalDocument.create(
      '123e4567-e89b-42d3-a456-426614174001',
      [animalId],
      'formula.pdf',
      'application/pdf',
      100,
      'users/owner/medical-documents/document/source.pdf',
      '123e4567-e89b-42d3-a456-426614174002',
    );
    document.markAnalyzing();
    document.completeAnalysis(extraction, { provider: 'TEST' });
    return document;
  }

  it('moves an analyzed document to review pending', () => {
    const document = analyzedDocument();

    expect(document.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(document.extraction).toEqual(extraction);
    expect(document.version).toBe(1);
  });

  it('preserves the original extraction when corrected data is accepted', () => {
    const document = analyzedDocument();
    const correctedExtraction = {
      ...extraction,
      diagnoses: [{ id: 'diagnosis-1', name: 'Dermatitis atopica' }],
    };

    document.accept(1, correctedExtraction, [
      {
        animalId,
        extractedItemIds: ['diagnosis-1', 'medication-1'],
      },
    ]);

    expect(document.status).toBe(MedicalDocumentStatus.Accepted);
    expect(document.extraction).toEqual(extraction);
    expect(document.validatedExtraction).toEqual(correctedExtraction);
    expect(document.version).toBe(2);
  });

  it('rejects assignments containing unknown item IDs', () => {
    const document = analyzedDocument();

    expect(() =>
      document.accept(1, extraction, [
        {
          animalId,
          extractedItemIds: ['unknown-item'],
        },
      ]),
    ).toThrow(InvalidArgumentError);
  });
});
