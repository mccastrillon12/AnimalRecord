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
        reportedSummary: 'Resumen escrito por el profesional',
        reportedRecommendations: 'Continuar cuidados en casa',
        reportedObservations: 'Paciente estable al alta',
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
    expect(dto.validatedExtraction).toEqual(
      expect.objectContaining({
        reportedSummary: 'Resumen escrito por el profesional',
        reportedRecommendations: 'Continuar cuidados en casa',
        reportedObservations: 'Paciente estable al alta',
      }),
    );
  });

  it('preserves authored imaging report text when filed as laboratory result', async () => {
    const dto = plainToInstance(ReviewMedicalDocumentDto, {
      decision: MedicalDocumentReviewDecision.Accept,
      documentVersion: 2,
      finalCategory: MedicalDocumentType.LaboratoryResult,
      validatedExtraction: {
        documentType: MedicalDocumentType.DiagnosticImage,
        patientHints: [],
        diagnoses: [],
        medications: [],
        vaccinations: [],
        medicalOrders: [],
        diagnosticImages: [
          {
            id: 'diagnostic-image-1',
            name: 'Reporte ecográfico abdominal',
            reportedTechnique:
              'Estudio ultrasonográfico con sonda microconvexa a 9 MHz',
            reportedFindings:
              'VEJIGA: presencia de sedimento de baja ecogenicidad.',
            reportedConclusion:
              'Imágenes ecográficas sugerentes de linfadenitis intestinal leve.',
            reportedDiagnosis: 'Linfadenitis intestinal leve',
          },
        ],
        additionalFields: {},
        warnings: [],
      },
      assignments: [
        {
          animalId: '123e4567-e89b-42d3-a456-426614174000',
          extractedItemIds: ['diagnostic-image-1'],
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.validatedExtraction?.diagnosticImages?.[0]).toEqual(
      expect.objectContaining({
        reportedTechnique:
          'Estudio ultrasonográfico con sonda microconvexa a 9 MHz',
        reportedFindings:
          'VEJIGA: presencia de sedimento de baja ecogenicidad.',
        reportedConclusion:
          'Imágenes ecográficas sugerentes de linfadenitis intestinal leve.',
      }),
    );
  });
});
