import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';
import { MedicalDocumentExtractionMapper } from '../../../src/context/medical-document/infrastructure/ai/medical-document-extraction-mapper';

describe('MedicalDocumentExtractionMapper', () => {
  const mapper = new MedicalDocumentExtractionMapper();
  const primaryExtraction = (result: ReturnType<typeof mapper.map>) =>
    result.extractionsByCategory[
      result.primaryDetectedCategory || MedicalDocumentType.Other
    ]!;

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

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(primaryExtraction(result).documentDate).toBe('2026-07-19');
    expect(primaryExtraction(result).diagnoses).toEqual([
      expect.objectContaining({
        id: 'diagnosis-1',
        name: 'Dermatitis',
        confidence: 0.92,
      }),
    ]);
    expect(primaryExtraction(result).medications).toEqual([
      expect.objectContaining({
        id: 'medication-1',
        name: 'Amoxicilina',
        dose: '250 mg',
        frequency: 'Cada 12 horas',
      }),
    ]);
    expect(primaryExtraction(result).additionalFields).toEqual({
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

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.Other,
    );
    expect(result.detectedCategories).toEqual([]);
    expect(result.primaryDetectedCategory).toBeUndefined();
    expect(primaryExtraction(result).summary).toBe(
      'Documento veterinario sin clasificar',
    );
    expect(primaryExtraction(result).warnings).toHaveLength(1);
  });

  it('merges BDA explainability metadata into extracted items', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: { name: 'animal-record-prescription' },
        document_class: { type: 'PRESCRIPTION' },
        inference_result: {
          diagnoses: ['Dermatitis'],
          medications: [{ name: 'Amoxicilina', dose: '250 mg' }],
          medical_orders: ['Control en 48 horas'],
        },
        explainability_info: [
          {
            diagnoses: [
              {
                confidence: 0.72,
                value: 'Dermatitis',
                geometry: [{ page: 1 }],
              },
            ],
            medications: [
              {
                name: {
                  confidence: 0.8,
                  value: 'Amoxicilina',
                  geometry: [{ page: 1 }],
                },
                dose: {
                  confidence: 0.7,
                  value: '250 mg',
                  geometry: [{ page: 1 }],
                },
              },
            ],
            medical_orders: [
              {
                confidence: 0.6,
                value: 'Control en 48 horas',
                geometry: [{ page: 1 }],
              },
            ],
          },
        ],
      }),
    );

    expect(primaryExtraction(result).diagnoses[0]).toEqual(
      expect.objectContaining({
        confidence: 0.72,
        source: { page: 1, text: 'Dermatitis' },
      }),
    );
    expect(primaryExtraction(result).medications[0]).toEqual(
      expect.objectContaining({
        confidence: 0.75,
        source: { page: 1, text: 'Amoxicilina' },
      }),
    );
    expect(primaryExtraction(result).medicalOrders).toEqual([]);
  });

  it('merges unnamed medical-order fragments into a single identified order', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: { name: 'animal-record-medical-order' },
        document_class: { type: 'MEDICAL_ORDER' },
        inference_result: {
          medical_orders: [
            {
              name: 'Radiografia de cadera',
              order_type: 'imagen diagnostica',
              instructions: 'Proyeccion ventrodorsal',
              priority: 'Programada',
            },
            {
              name: '',
              order_type: '',
              instructions: 'Ayuno de 8 horas',
              priority: '',
            },
            {
              name: '',
              order_type: '',
              instructions: 'Sedacion segun valoracion medica',
              priority: '',
            },
            {
              name: '',
              order_type: '',
              instructions: 'Cantidad: 1',
              priority: '',
            },
          ],
        },
      }),
    );

    expect(primaryExtraction(result).medicalOrders).toEqual([
      expect.objectContaining({
        name: 'Radiografia de cadera',
        orderType: 'imagen diagnostica',
        priority: 'Programada',
        instructions:
          'Proyeccion ventrodorsal; Ayuno de 8 horas; Sedacion segun valoracion medica; Cantidad: 1',
      }),
    ]);
  });

  it('maps referral blueprint details without confusing them with medical orders', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: { name: 'animal-record-referral', confidence: 0.96 },
        document_class: { type: 'REFERRAL' },
        inference_result: {
          referral_number: '001-2024',
          patient: {
            name: 'BENJI',
            species: 'Felino',
            breed: 'Persa',
            sex: 'Macho',
            color: 'Blanco y negro',
            size: 'Pequeno',
            reproductive_status: 'No esterilizado',
            age: '0 anos, 7 meses y 11 dias',
          },
          owner: {
            name: 'Maria Clara Pino Romero',
            identification: '1037644692',
            email: 'maclapiro@gmail.com',
          },
          patient_hints: [],
          referral: {
            reason: 'Evaluacion por soplo cardiaco',
            destination: 'Dr. Alejandro Torres - Clinica CardioVet',
            specialty: 'Cardiologia veterinaria',
            clinical_summary: 'Intolerancia al ejercicio y tos ocasional',
          },
          studies_performed: ['Hemograma sin alteraciones significativas'],
          current_treatment_summary: 'Sin tratamiento cardiaco previo',
        },
      }),
    );

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.Referral,
    );
    expect(primaryExtraction(result).patient).toEqual({
      name: 'BENJI',
      species: 'Felino',
      breed: 'Persa',
      sex: 'Macho',
      color: 'Blanco y negro',
      size: 'Pequeno',
      reproductiveStatus: 'No esterilizado',
      age: '0 anos, 7 meses y 11 dias',
    });
    expect(primaryExtraction(result).owner).toEqual({
      name: 'Maria Clara Pino Romero',
      identification: '1037644692',
      email: 'maclapiro@gmail.com',
    });
    expect(primaryExtraction(result).referral).toEqual(
      expect.objectContaining({
        reason: 'Evaluacion por soplo cardiaco',
        destination: 'Dr. Alejandro Torres - Clinica CardioVet',
        specialty: 'Cardiologia veterinaria',
        clinicalSummary: 'Intolerancia al ejercicio y tos ocasional',
      }),
    );
    expect(primaryExtraction(result).medicalOrders).toEqual([]);
    expect(primaryExtraction(result).additionalFields).toEqual(
      expect.objectContaining({
        referral_number: '001-2024',
        studies_performed: ['Hemograma sin alteraciones significativas'],
        current_treatment_summary: 'Sin tratamiento cardiaco previo',
      }),
    );
  });

  it('merges structured patient and owner data found on separate pages', () => {
    const result = mapper.mapSegments([
      {
        customOutput: JSON.stringify({
          document_class: { type: 'REFERRAL' },
          inference_result: {
            patient: { name: 'BENJI', species: 'Felino' },
          },
        }),
      },
      {
        customOutput: JSON.stringify({
          document_class: { type: 'REFERRAL' },
          inference_result: {
            patient: { breed: 'Persa' },
            owner: { name: 'Maria Clara Pino Romero' },
          },
        }),
      },
    ]);

    expect(primaryExtraction(result).patient).toEqual({
      name: 'BENJI',
      species: 'Felino',
      breed: 'Persa',
    });
    expect(primaryExtraction(result).owner).toEqual({
      name: 'Maria Clara Pino Romero',
    });
  });

  it('maps extended vaccination certificate fields', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: {
          name: 'animal-record-vaccination-card',
          confidence: 0.98,
        },
        document_class: { type: 'VACCINATION_CARD' },
        inference_result: {
          patient_hints: ['Luna', 'Canine', 'Microchip 985112012654269'],
          vaccinations: [
            {
              name: 'Rabies',
              diseases_covered: 'Rabia',
              brand: 'Nobivac 1',
              manufacturer: 'Zoetis',
              vaccine_type: 'Killed virus',
              lot: '791958',
              lot_expiration_date: '7/18/2026',
              application_date: '10/27/2025',
              next_dose_date: '10/27/2028',
              route: 'Subcutaneous',
              application_site: 'Right rear',
              tag_number: 'BROWARD',
              veterinarian: 'Dr. Maria Isabel Albers Alvarez',
            },
          ],
        },
      }),
    );

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.VaccinationCard,
    );
    expect(primaryExtraction(result).vaccinations).toEqual([
      expect.objectContaining({
        name: 'Rabies',
        diseasesCovered: ['Rabia'],
        brand: 'Nobivac 1',
        manufacturer: 'Zoetis',
        vaccineType: 'Killed virus',
        lot: '791958',
        lotExpirationDate: '7/18/2026',
        applicationDate: '10/27/2025',
        nextDoseDate: '10/27/2028',
        route: 'Subcutaneous',
        applicationSite: 'Right rear',
        tagNumber: 'BROWARD',
        veterinarian: 'Dr. Maria Isabel Albers Alvarez',
      }),
    ]);
  });

  it('maps clinical history sections and relevant diagnostic results', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: {
          name: 'animal-record-clinical-history',
          confidence: 0.96,
        },
        document_class: { type: 'CLINICAL_HISTORY' },
        inference_result: {
          history_number: '46112',
          document_date: '2026-08-04',
          patient_hints: ['Luna', 'Canina', 'Microchip 985141000245781'],
          clinical_history: {
            reason_for_consultation: 'Prurito y enrojecimiento en los oidos',
            anamnesis: 'Siete dias de rascado intenso',
            physical_exam: 'Paciente alerta con mucosas rosadas',
            vital_signs: 'Temperatura 38.7 C; FC 96 lpm; FR 24 rpm',
            clinical_findings: 'Eritema y secrecion ceruminosa bilateral',
            treatment_plan: 'Limpieza otica cada 12 horas',
            recommendations: 'Evitar humedad en los oidos',
            follow_up: 'Control en 8 dias',
          },
          diagnoses: ['Otitis externa bilateral'],
          diagnostic_results: [
            {
              name: 'Citologia otica',
              date: '2026-08-04',
              result: 'Abundantes levaduras',
              interpretation: 'Compatible con otitis por levaduras',
              status: 'Final',
            },
          ],
        },
      }),
    );

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.ClinicalHistory,
    );
    expect(primaryExtraction(result).clinicalHistory).toEqual(
      expect.objectContaining({
        reasonForConsultation: 'Prurito y enrojecimiento en los oidos',
        vitalSigns: ['Temperatura 38.7 C; FC 96 lpm; FR 24 rpm'],
        clinicalFindings: ['Eritema y secrecion ceruminosa bilateral'],
        followUp: 'Control en 8 dias',
      }),
    );
    expect(primaryExtraction(result).diagnosticResults).toEqual([
      expect.objectContaining({
        id: 'diagnostic-result-1',
        name: 'Citologia otica',
        result: 'Abundantes levaduras',
        status: 'Final',
      }),
    ]);
    expect(
      primaryExtraction(result).diagnosticResults?.[0]?.interpretation,
    ).toBeUndefined();
    expect(primaryExtraction(result).additionalFields).toEqual({
      history_number: '46112',
    });
  });

  it('classifies a standalone laboratory report as OTHER without AI interpretation', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: {
          name: 'animal-record-clinical-history_v2',
          confidence: 0.6725593,
        },
        document_class: { type: 'CLINICAL_HISTORY' },
        inference_result: {
          history_number: 'N/R',
          document_date: '09/06/2018',
          summary:
            'Hemograma con neutrofilia relativa, creatinina elevada y ALT normal.',
          issuer: {
            name: 'Carolina Vargas',
            clinic: 'Particular',
            professional_id: 'Reg. 05-520214',
          },
          patient: {
            name: 'Albóndiga',
            identifier: '680',
            species: 'Canino',
            breed: 'Bulldog Ingles',
            sex: 'Hembra',
            age: '9 Años',
          },
          owner: { name: 'Carolina Gañan' },
          patient_hints: ['No Ingreso 680', 'Historia Clínica N/R'],
          clinical_history: {
            vital_signs: 'Prot. P 7 gr/dl (6.0-7.8 gr/dl)',
            clinical_findings:
              'Neutrofilos 83% y creatinina 1.7 mg/dl interpretados como elevados',
          },
          diagnostic_results: [
            {
              name: 'Hemograma Completo',
              date: '09/06/2018',
              interpretation:
                'Glóbulos Rojos Normales en Morfología. Glóbulos Blancos Sin Granulaciones Citotóxicas',
            },
            {
              name: 'Química Sanguínea',
              date: '09/06/2018',
            },
          ],
          document_sections: [
            {
              category: 'CLINICAL_HISTORY',
              page_start: 1,
              page_end: 1,
              summary: 'Hemograma completo y química sanguínea',
              evidence: 'HEMOGRAMA COMPLETO',
            },
          ],
        },
      }),
    );

    expect(result.primaryDetectedCategory).toBeUndefined();
    expect(result.detectedCategories).toEqual([]);
    const otherExtraction =
      result.extractionsByCategory[MedicalDocumentType.Other];
    expect(otherExtraction?.documentType).toBe(MedicalDocumentType.Other);
    expect(otherExtraction?.documentTypeConfidence).toBeUndefined();
    expect(otherExtraction?.summary).toBe(
      'Informe diagnostico veterinario independiente con resultados visibles. La IA no genero una interpretacion clinica.',
    );
    expect(otherExtraction?.patient?.name).toBe('Albóndiga');
    expect(otherExtraction?.owner?.name).toBe('Carolina Gañan');
    expect(otherExtraction?.clinicalHistory).toBeUndefined();
    expect(otherExtraction?.diagnosticResults).toEqual([]);
    expect(otherExtraction?.warnings).toContain(
      'Standalone diagnostic report classified as OTHER; AI-generated clinical interpretation was removed.',
    );
  });

  it('keeps vaccination histories classified as vaccination cards', () => {
    const result = mapper.map(
      JSON.stringify({
        document_class: { type: 'Vaccination History' },
        inference_result: {},
      }),
    );

    expect(primaryExtraction(result).documentType).toBe(
      MedicalDocumentType.VaccinationCard,
    );
  });

  it('exposes AWS zero-based page ranges as one-based page numbers', () => {
    const result = mapper.mapSegments([
      {
        customOutput: JSON.stringify({
          document_class: { type: 'PRESCRIPTION' },
          inference_result: {},
        }),
        standardOutput: JSON.stringify({
          metadata: { start_page_index: 0, end_page_index: 1 },
        }),
      },
    ]);

    expect(result.detectedCategories).toEqual([
      expect.objectContaining({
        category: MedicalDocumentType.Prescription,
        pageStart: 1,
        pageEnd: 1,
      }),
    ]);
  });

  it('consolidates every logical subdocument and keeps category extractions separate', () => {
    const result = mapper.mapSegments([
      {
        customOutput: JSON.stringify({
          matched_blueprint: {
            name: 'animal-record-prescription',
            confidence: 0.92,
          },
          document_class: { type: 'PRESCRIPTION' },
          inference_result: {
            medications: [{ name: 'Amoxicilina' }],
          },
        }),
        standardOutput: JSON.stringify({
          metadata: { start_page_index: 0, end_page_index: 2 },
        }),
      },
      {
        customOutput: JSON.stringify({
          matched_blueprint: {
            name: 'animal-record-referral',
            confidence: 0.81,
          },
          document_class: { type: 'REFERRAL' },
          inference_result: {
            referral: { reason: 'Valoracion por cardiologia' },
          },
        }),
        standardOutput: JSON.stringify({
          metadata: { start_page_index: 2, end_page_index: 4 },
        }),
      },
    ]);

    expect(result.primaryDetectedCategory).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(result.detectedCategories).toEqual([
      expect.objectContaining({
        category: MedicalDocumentType.Prescription,
        pageStart: 1,
        pageEnd: 2,
      }),
      expect.objectContaining({
        category: MedicalDocumentType.Referral,
        pageStart: 3,
        pageEnd: 4,
      }),
    ]);
    expect(
      result.extractionsByCategory[MedicalDocumentType.Prescription]
        ?.medications,
    ).toHaveLength(1);
    expect(
      result.extractionsByCategory[MedicalDocumentType.Referral]?.referral
        ?.reason,
    ).toBe('Valoracion por cardiologia');
    expect(result.providerMetadata.segmentCount).toBe(2);
  });

  it('maps additional document sections without mixing their structured data', () => {
    const result = mapper.map(
      JSON.stringify({
        matched_blueprint: {
          name: 'animal-record-clinical-history',
          confidence: 0.96,
        },
        document_class: { type: 'CLINICAL_HISTORY' },
        inference_result: {
          diagnoses: ['Otitis externa'],
          medications: [{ name: 'Amoxicilina' }],
          clinical_history: { anamnesis: 'Prurito durante siete dias' },
          document_sections: [
            {
              category: 'CLINICAL_HISTORY',
              page_start: 1,
              page_end: 4,
            },
            {
              category: 'PRESCRIPTION',
              page_start: 5,
              page_end: 5,
              evidence: 'FORMULA MEDICA',
            },
          ],
        },
      }),
    );

    expect(result.detectedCategories).toHaveLength(2);
    expect(
      result.extractionsByCategory[MedicalDocumentType.ClinicalHistory]
        ?.medications,
    ).toEqual([]);
    expect(
      result.extractionsByCategory[MedicalDocumentType.Prescription]
        ?.medications,
    ).toEqual([expect.objectContaining({ name: 'Amoxicilina' })]);
  });
});
