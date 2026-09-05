import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  MedicalDocumentReviewDecision,
  ReviewMedicalDocumentDto,
} from '../../../src/app/medical-document/review-medical-document.dto';
import {
  MedicalDocumentRejectionReason,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';

describe('ReviewMedicalDocumentDto rejection validation', () => {
  async function errors(
    values: Partial<ReviewMedicalDocumentDto>,
  ): Promise<string[]> {
    const dto = Object.assign(new ReviewMedicalDocumentDto(), {
      decision: MedicalDocumentReviewDecision.Reject,
      documentVersion: 1,
      ...values,
    });
    return (await validate(dto)).map((error) => error.property);
  }

  it('requires a rejection reason', async () => {
    await expect(errors({})).resolves.toContain('rejectionReason');
  });

  it('requires a comment for OTHER', async () => {
    await expect(
      errors({ rejectionReason: MedicalDocumentRejectionReason.Other }),
    ).resolves.toContain('rejectionComment');
  });

  it('accepts a comment for OTHER and no comment for predefined reasons', async () => {
    await expect(
      errors({
        rejectionReason: MedicalDocumentRejectionReason.Other,
        rejectionComment: 'La información no corresponde',
      }),
    ).resolves.toEqual([]);
    await expect(
      errors({
        rejectionReason: MedicalDocumentRejectionReason.WrongAnimal,
      }),
    ).resolves.toEqual([]);
  });
});

describe('ReviewMedicalDocumentDto acceptance validation', () => {
  it('accepts different filing and extraction categories', async () => {
    const dto = plainToInstance(ReviewMedicalDocumentDto, {
      decision: MedicalDocumentReviewDecision.Accept,
      documentVersion: 1,
      finalCategory: MedicalDocumentType.VaccinationCard,
      validatedExtraction: {
        documentType: MedicalDocumentType.ClinicalHistory,
        patientHints: [],
        diagnoses: [],
        medications: [],
        vaccinations: [],
        medicalOrders: [],
        clinicalHistory: { reasonForConsultation: 'Control general' },
        additionalFields: {},
        warnings: [],
      },
      assignments: [
        {
          animalId: '123e4567-e89b-42d3-a456-426614174000',
          extractedItemIds: [],
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
