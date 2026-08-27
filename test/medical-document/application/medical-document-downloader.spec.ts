import { MedicalDocumentDownloader } from '../../../src/context/medical-document/application/medical-document-downloader';
import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';

describe('MedicalDocumentDownloader', () => {
  it('generates the URL from a final animal location', async () => {
    const ownerId = 'owner-id';
    const animalId = 'animal-id';
    const extraction: MedicalDocumentExtraction = {
      documentType: MedicalDocumentType.Prescription,
      patientHints: [],
      diagnoses: [],
      medications: [],
      vaccinations: [],
      medicalOrders: [],
      additionalFields: {},
      warnings: [],
    };
    const document = MedicalDocument.create(
      ownerId,
      [animalId],
      'formula.pdf',
      'application/pdf',
      100,
      'users/owner-id/medical-document-intake/document-id/source.pdf',
      'document-id',
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );
    const finalStorageKey =
      'users/owner-id/animals/animal-id/medical-documents/prescriptions/document-id/source.pdf';
    document.accept(
      1,
      MedicalDocumentType.Prescription,
      extraction,
      [{ animalId, extractedItemIds: [] }],
      [{ animalId, storageKey: finalStorageKey }],
      { value: 'F-57-01', sequence: 1, countryCode: '57' },
    );

    const generateDownloadUrl = jest.fn().mockResolvedValue('signed-url');
    const storage = {
      generateDownloadUrl,
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const finder = {
      findById: jest.fn().mockResolvedValue(document),
    } as unknown as jest.Mocked<MedicalDocumentFinder>;
    const downloader = new MedicalDocumentDownloader(storage, finder);

    await expect(downloader.run(document.id, ownerId)).resolves.toEqual({
      downloadUrl: 'signed-url',
      expiresIn: 300,
    });
    expect(generateDownloadUrl).toHaveBeenCalledWith(
      finalStorageKey,
      'formula.pdf',
    );
  });
});
