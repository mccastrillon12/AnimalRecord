import {
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MedicalDocumentDownloader } from '../../../src/context/medical-document/application/medical-document-downloader';
import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { AwsMedicalDocumentStorage } from '../../../src/context/medical-document/infrastructure/storage/aws-medical-document-storage';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

describe('MedicalDocumentDownloader', () => {
  it('signs the final location of a copy from intake with simulated S3', async () => {
    const ownerId = 'owner-id';
    const animalId = 'animal-id';
    const bucket = 'animal-record-test';
    const sourceStorageKey =
      'users/owner-id/medical-document-intake/document-id/source.pdf';
    const content = Buffer.from('%PDF-1.4\n');
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
      content.length,
      sourceStorageKey,
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

    const storage = new AwsMedicalDocumentStorage({
      getAwsS3BucketName: () => bucket,
      getAwsS3Region: () => 'us-east-1',
    } as unknown as EnvironmentConfigService);
    const finder = {
      findById: jest.fn().mockResolvedValue(document),
    } as unknown as jest.Mocked<MedicalDocumentFinder>;
    const downloader = new MedicalDocumentDownloader(storage, finder);

    const presign = jest
      .mocked(getSignedUrl)
      .mockResolvedValueOnce('signed-url');
    const send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((() => Promise.resolve({})) as never);
    try {
      await expect(
        storage.putObject(sourceStorageKey, content, 'application/pdf'),
      ).resolves.toBe(`s3://${bucket}/${sourceStorageKey}`);
      await storage.copyObject(sourceStorageKey, finalStorageKey);
      await expect(downloader.run(document.id, ownerId)).resolves.toEqual({
        downloadUrl: 'signed-url',
        expiresIn: 300,
      });

      expect(send).toHaveBeenCalledTimes(2);
      const [[put], [copy]] = send.mock.calls;
      expect(put).toBeInstanceOf(PutObjectCommand);
      expect(put.input).toEqual({
        Bucket: bucket,
        Key: sourceStorageKey,
        Body: content,
        ContentType: 'application/pdf',
      });
      expect(copy).toBeInstanceOf(CopyObjectCommand);
      expect(copy.input).toEqual({
        Bucket: bucket,
        Key: finalStorageKey,
        CopySource: `${bucket}/${sourceStorageKey}`,
      });
      const [, command, options] = presign.mock.lastCall!;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({
        Bucket: bucket,
        Key: finalStorageKey,
        ResponseContentDisposition: 'attachment; filename="formula.pdf"',
      });
      expect(options).toEqual({ expiresIn: 300 });
    } finally {
      send.mockRestore();
    }
  });
});
