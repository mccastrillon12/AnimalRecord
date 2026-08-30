import { MedicalDocumentCodeGenerator } from '../../../src/context/medical-document/application/medical-document-code-generator';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';
import { MongoCounterRepository } from '../../../src/context/shared/infrastructure/persistence/mongo/mongo-counter-repository';

describe('MedicalDocumentCodeGenerator', () => {
  let counterRepository: jest.Mocked<MongoCounterRepository>;
  let generator: MedicalDocumentCodeGenerator;
  let getNextSequence: jest.MockedFunction<
    MongoCounterRepository['getNextSequence']
  >;

  beforeEach(() => {
    getNextSequence = jest.fn();
    counterRepository = {
      getNextSequence,
    } as unknown as jest.Mocked<MongoCounterRepository>;
    generator = new MedicalDocumentCodeGenerator(counterRepository);
  });

  it.each([
    [MedicalDocumentType.Prescription, 'F'],
    [MedicalDocumentType.MedicalOrder, 'O'],
    [MedicalDocumentType.Referral, 'R'],
    [MedicalDocumentType.ClinicalHistory, 'H'],
    [MedicalDocumentType.DiagnosticImage, 'I'],
  ])('generates a global code for %s', async (category, prefix) => {
    getNextSequence.mockResolvedValue(1);

    await expect(generator.generate(category)).resolves.toEqual({
      value: `${prefix}-57-01`,
      sequence: 1,
      countryCode: '57',
    });
    expect(getNextSequence).toHaveBeenCalledWith(
      `medical_document_code_57_${category}`,
    );
  });

  it('uses two digits as a minimum without truncating larger values', async () => {
    getNextSequence.mockResolvedValue(100);

    await expect(
      generator.generate(MedicalDocumentType.Prescription),
    ).resolves.toEqual({
      value: 'F-57-100',
      sequence: 100,
      countryCode: '57',
    });
  });

  it.each([MedicalDocumentType.VaccinationCard, MedicalDocumentType.Other])(
    'does not consume a counter for %s',
    async (category) => {
      await expect(generator.generate(category)).resolves.toBeUndefined();
      expect(getNextSequence).not.toHaveBeenCalled();
    },
  );
});
