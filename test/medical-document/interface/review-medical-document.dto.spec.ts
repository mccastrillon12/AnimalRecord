import { validate } from 'class-validator';
import {
  MedicalDocumentReviewDecision,
  ReviewMedicalDocumentDto,
} from '../../../src/app/medical-document/review-medical-document.dto';
import { MedicalDocumentRejectionReason } from '../../../src/context/medical-document/domain/medical-document';

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
