import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyzeMedicalDocumentDto } from '../../../src/app/medical-document/analyze-medical-document.dto';

describe('AnalyzeMedicalDocumentDto', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174000';

  it('normalizes an optional description from multipart form data', async () => {
    const dto = plainToInstance(AnalyzeMedicalDocumentDto, {
      animalIds: JSON.stringify([animalId]),
      description: '  Control veterinario de agosto  ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.description).toBe('Control veterinario de agosto');
  });

  it('treats a blank description as absent', async () => {
    const dto = plainToInstance(AnalyzeMedicalDocumentDto, {
      animalIds: [animalId],
      description: '   ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.description).toBeUndefined();
  });

  it('rejects descriptions longer than 500 characters', async () => {
    const dto = plainToInstance(AnalyzeMedicalDocumentDto, {
      animalIds: [animalId],
      description: 'a'.repeat(501),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('description');
  });
});
