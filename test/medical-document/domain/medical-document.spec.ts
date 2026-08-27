import {
  MedicalDocument,
  MedicalDocumentClassificationOutcome,
  MedicalDocumentExtraction,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';

describe('MedicalDocument', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174000';
  const documentLocations = [
    {
      animalId,
      storageKey:
        'users/owner/animals/animal/medical-documents/prescriptions/document/source.pdf',
    },
  ];
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
  const documentCode = {
    value: 'F-57-01',
    sequence: 1,
    countryCode: '57',
  };

  function analyzedDocument(
    requestedCategory:
      | MedicalDocumentType
      | undefined = MedicalDocumentType.Prescription,
  ): MedicalDocument {
    const document = MedicalDocument.create(
      '123e4567-e89b-42d3-a456-426614174001',
      [animalId],
      'formula.pdf',
      'application/pdf',
      100,
      'users/owner/medical-documents/document/source.pdf',
      '123e4567-e89b-42d3-a456-426614174002',
      requestedCategory,
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription, confidence: 0.95 }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );
    return document;
  }

  it('moves an analyzed document to review pending', () => {
    const document = analyzedDocument();

    expect(document.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(document.extraction).toEqual(extraction);
    expect(document.classificationOutcome).toBe(
      MedicalDocumentClassificationOutcome.Match,
    );
    expect(document.version).toBe(1);
  });

  it('preserves the original extraction when corrected data is accepted', () => {
    const document = analyzedDocument();
    const correctedExtraction = {
      ...extraction,
      diagnoses: [{ id: 'diagnosis-1', name: 'Dermatitis atopica' }],
    };

    document.accept(
      1,
      MedicalDocumentType.Prescription,
      correctedExtraction,
      [
        {
          animalId,
          extractedItemIds: ['diagnosis-1', 'medication-1'],
        },
      ],
      documentLocations,
      documentCode,
    );

    expect(document.status).toBe(MedicalDocumentStatus.Accepted);
    expect(document.extraction).toEqual(extraction);
    expect(document.validatedExtraction).toEqual(correctedExtraction);
    expect(document.finalCategory).toBe(MedicalDocumentType.Prescription);
    expect(document.documentCode).toBe('F-57-01');
    expect(Object.keys(document.extractionsByCategory)).toEqual([
      MedicalDocumentType.Prescription,
    ]);
    expect(document.version).toBe(2);
  });

  it('rejects assignments containing unknown item IDs', () => {
    const document = analyzedDocument();

    expect(() =>
      document.accept(
        1,
        MedicalDocumentType.Prescription,
        extraction,
        [
          {
            animalId,
            extractedItemIds: ['unknown-item'],
          },
        ],
        documentLocations,
        documentCode,
      ),
    ).toThrow(InvalidArgumentError);
  });

  it.each([
    {
      requested: MedicalDocumentType.Prescription,
      detections: [MedicalDocumentType.Referral],
      expected: MedicalDocumentClassificationOutcome.Mismatch,
    },
    {
      requested: MedicalDocumentType.Prescription,
      detections: [MedicalDocumentType.Prescription],
      expected: MedicalDocumentClassificationOutcome.Match,
    },
    {
      requested: MedicalDocumentType.Prescription,
      detections: [
        MedicalDocumentType.Prescription,
        MedicalDocumentType.Referral,
      ],
      expected: MedicalDocumentClassificationOutcome.MatchWithAdditional,
    },
    {
      requested: undefined,
      detections: [MedicalDocumentType.Prescription],
      expected: MedicalDocumentClassificationOutcome.Detected,
    },
    {
      requested: undefined,
      detections: [
        MedicalDocumentType.Prescription,
        MedicalDocumentType.Referral,
      ],
      expected: MedicalDocumentClassificationOutcome.Multiple,
    },
    {
      requested: MedicalDocumentType.Prescription,
      detections: [],
      expected: MedicalDocumentClassificationOutcome.Unclassified,
    },
  ])(
    'resolves $expected from requested and detected categories',
    ({ requested, detections, expected }) => {
      const document = MedicalDocument.create(
        'owner',
        [animalId],
        'document.pdf',
        'application/pdf',
        100,
        'document.pdf',
        'document-id',
        requested,
      );
      const extractions = Object.fromEntries(
        detections.map((category) => [
          category,
          { ...extraction, documentType: category },
        ]),
      );
      document.markAnalyzing();
      document.completeAnalysis(
        detections[0],
        detections.map((category) => ({ category })),
        extractions,
        { provider: 'TEST' },
      );

      expect(document.classificationOutcome).toBe(expected);
    },
  );

  it('keeps AI detection independent from the requested category', () => {
    const createDocument = (requestedCategory?: MedicalDocumentType) => {
      const document = MedicalDocument.create(
        'owner',
        [animalId],
        'restaurant-menu.pdf',
        'application/pdf',
        100,
        `menu-${requestedCategory || 'general'}.pdf`,
        `document-${requestedCategory || 'general'}`,
        requestedCategory,
      );
      const otherExtraction: MedicalDocumentExtraction = {
        ...extraction,
        documentType: MedicalDocumentType.Other,
        diagnoses: [],
        medications: [],
      };
      document.markAnalyzing();
      document.completeAnalysis(
        undefined,
        [],
        { [MedicalDocumentType.Other]: otherExtraction },
        { provider: 'TEST' },
      );
      return document;
    };

    const generalUpload = createDocument();
    const prescriptionUpload = createDocument(MedicalDocumentType.Prescription);

    expect(prescriptionUpload.requestedCategory).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(prescriptionUpload.primaryDetectedCategory).toBeUndefined();
    expect(prescriptionUpload.detectedCategories).toEqual(
      generalUpload.detectedCategories,
    );
    expect(prescriptionUpload.extractionsByCategory).toEqual(
      generalUpload.extractionsByCategory,
    );
    expect(prescriptionUpload.classificationOutcome).toBe(
      MedicalDocumentClassificationOutcome.Unclassified,
    );
  });

  it('allows a manually selected final category but rejects mixed category data', () => {
    const document = analyzedDocument(undefined);
    const vaccinationExtraction: MedicalDocumentExtraction = {
      ...extraction,
      documentType: MedicalDocumentType.VaccinationCard,
      diagnoses: [],
      medications: [],
      vaccinations: [{ id: 'vaccination-1', name: 'Rabia' }],
    };

    expect(() =>
      document.accept(
        1,
        MedicalDocumentType.VaccinationCard,
        { ...vaccinationExtraction, medications: extraction.medications },
        [{ animalId, extractedItemIds: ['vaccination-1'] }],
        documentLocations,
      ),
    ).toThrow(InvalidArgumentError);

    document.accept(
      1,
      MedicalDocumentType.VaccinationCard,
      vaccinationExtraction,
      [{ animalId, extractedItemIds: ['vaccination-1'] }],
      documentLocations,
    );

    expect(document.finalCategory).toBe(MedicalDocumentType.VaccinationCard);
    expect(document.validatedExtraction).toEqual(vaccinationExtraction);
    expect(document.documentLocations).toEqual(documentLocations);
  });

  it('requires a matching code for categories with a consecutive', () => {
    const document = analyzedDocument();

    expect(() =>
      document.accept(
        1,
        MedicalDocumentType.Prescription,
        extraction,
        [{ animalId, extractedItemIds: ['diagnosis-1', 'medication-1'] }],
        documentLocations,
      ),
    ).toThrow('require a consecutive code');

    expect(() =>
      document.accept(
        1,
        MedicalDocumentType.Prescription,
        extraction,
        [{ animalId, extractedItemIds: ['diagnosis-1', 'medication-1'] }],
        documentLocations,
        { ...documentCode, value: 'O-57-01' },
      ),
    ).toThrow('must match PRESCRIPTION');
  });

  it('reconstructs classification fields from a legacy extraction record', () => {
    const document = MedicalDocument.fromPrimitives({
      id: 'legacy-document',
      ownerId: 'owner',
      animalIds: [animalId],
      originalFileName: 'formula.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      storageKey: 'legacy/source.pdf',
      status: MedicalDocumentStatus.ReviewPending,
      detectedCategories: [],
      extractionsByCategory: {},
      extraction,
      assignments: [],
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(document.primaryDetectedCategory).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(document.detectedCategories).toEqual([
      expect.objectContaining({ category: MedicalDocumentType.Prescription }),
    ]);
    expect(document.classificationOutcome).toBe(
      MedicalDocumentClassificationOutcome.Detected,
    );
    expect(document.extractionsByCategory).toEqual({
      [MedicalDocumentType.Prescription]: extraction,
    });
  });

  it('requires an independent extraction for every detected category', () => {
    const document = MedicalDocument.create(
      'owner',
      [animalId],
      'mixed.pdf',
      'application/pdf',
      100,
      'mixed.pdf',
    );
    document.markAnalyzing();

    expect(() =>
      document.completeAnalysis(
        MedicalDocumentType.Prescription,
        [
          { category: MedicalDocumentType.Prescription },
          { category: MedicalDocumentType.Referral },
        ],
        { [MedicalDocumentType.Prescription]: extraction },
        { provider: 'TEST' },
      ),
    ).toThrow(InvalidArgumentError);
  });
});
