import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';
import { MedicalDocumentExtractionMapper } from '../../../src/context/medical-document/infrastructure/ai/medical-document-extraction-mapper';

describe('MedicalDocumentExtractionMapper', () => {
  const mapper = new MedicalDocumentExtractionMapper();

  it('maps a Bedrock blueprint output to the canonical extraction contract', () => {
    const customOutput = JSON.stringify({
      matched_blueprint: {
        arn: 'arn:aws:bedrock:us-east-1:123:blueprint/prescription',
        name: 'animal-record-prescription',
        version: '1',
        confidence: 0.97,
      },
      inference_result: {
        document_type: 'FORMULA',
        fecha_documento: '2026-07-19',
        diagnosticos: [{ nombre: 'Dermatitis', confianza: 0.92 }],
        medicamentos: [
          {
            nombre: 'Amoxicilina',
            dosis: '250 mg',
            frecuencia: 'Cada 12 horas',
          },
        ],
        campo_no_estandar: 'valor',
      },
    });

    const result = mapper.map(customOutput);

    expect(result.extraction.documentType).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(result.extraction.documentDate).toBe('2026-07-19');
    expect(result.extraction.diagnoses).toEqual([
      expect.objectContaining({
        id: 'diagnosis-1',
        name: 'Dermatitis',
        confidence: 0.92,
      }),
    ]);
    expect(result.extraction.medications).toEqual([
      expect.objectContaining({
        id: 'medication-1',
        name: 'Amoxicilina',
        dose: '250 mg',
        frequency: 'Cada 12 horas',
      }),
    ]);
    expect(result.extraction.additionalFields).toEqual({
      campo_no_estandar: 'valor',
    });
    expect(result.providerMetadata.matchConfidence).toBe(0.97);
  });

  it('returns OTHER with a warning when no blueprint matches', () => {
    const result = mapper.map(
      undefined,
      JSON.stringify({
        document: { summary: 'Documento veterinario sin clasificar' },
      }),
    );

    expect(result.extraction.documentType).toBe(MedicalDocumentType.Other);
    expect(result.extraction.summary).toBe(
      'Documento veterinario sin clasificar',
    );
    expect(result.extraction.warnings).toHaveLength(1);
  });
});
