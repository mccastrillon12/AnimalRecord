import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AnalyzeMedicalDocumentReplacementDto,
  RemoveMedicalDocumentFromAnimalDto,
  ReviewMedicalDocumentReplacementDto,
} from '../../../src/app/medical-document/replace-medical-document.dto';
import { MedicalDocumentReviewDecision } from '../../../src/app/medical-document/review-medical-document.dto';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';

describe('Medical document replacement DTOs', () => {
  const candidateDocumentId = '123e4567-e89b-42d3-a456-426614174000';

  it('transforms multipart and query versions to numbers', async () => {
    const analyze = plainToInstance(AnalyzeMedicalDocumentReplacementDto, {
      documentVersion: '3',
      animalIds: JSON.stringify([candidateDocumentId]),
    });
    const remove = plainToInstance(RemoveMedicalDocumentFromAnimalDto, {
      documentVersion: '4',
    });

    await expect(validate(analyze)).resolves.toEqual([]);
    await expect(validate(remove)).resolves.toEqual([]);
    expect(analyze.documentVersion).toBe(3);
    expect(remove.documentVersion).toBe(4);
  });

  it('allows rejection without an extraction but requires it for acceptance', async () => {
    const reject = plainToInstance(ReviewMedicalDocumentReplacementDto, {
      decision: MedicalDocumentReviewDecision.Reject,
      candidateDocumentId,
      documentVersion: 3,
      candidateVersion: 1,
      documentVersions: [{ documentId: candidateDocumentId, version: 3 }],
    });
    const accept = plainToInstance(ReviewMedicalDocumentReplacementDto, {
      decision: MedicalDocumentReviewDecision.Accept,
      candidateDocumentId,
      documentVersion: 3,
      candidateVersion: 1,
    });

    await expect(validate(reject)).resolves.toEqual([]);
    const acceptanceErrors = await validate(accept);
    expect(acceptanceErrors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'documentVersions',
        'finalCategory',
        'validatedExtraction',
        'assignments',
      ]),
    );
  });

  it('accepts a user-selected destination category on replacement', async () => {
    const accept = plainToInstance(ReviewMedicalDocumentReplacementDto, {
      decision: MedicalDocumentReviewDecision.Accept,
      candidateDocumentId,
      documentVersion: 3,
      candidateVersion: 1,
      documentVersions: [{ documentId: candidateDocumentId, version: 3 }],
      finalCategory: MedicalDocumentType.Prescription,
      validatedExtraction: {
        documentType: MedicalDocumentType.ClinicalHistory,
        patientHints: [],
        diagnoses: [],
        medications: [],
        vaccinations: [],
        medicalOrders: [],
        additionalFields: {},
        warnings: [],
      },
      assignments: [{ animalId: candidateDocumentId, extractedItemIds: [] }],
    });

    await expect(validate(accept)).resolves.toEqual([]);
  });
});
