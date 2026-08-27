import { MedicalDocumentFeedbackValue } from '../../../src/context/medical-document/domain/medical-document-feedback';
import { MongoMedicalDocumentFeedbackRepository } from '../../../src/context/medical-document/infrastructure/persistence/mongo/mongo-medical-document-feedback-repository';

describe('MongoMedicalDocumentFeedbackRepository', () => {
  it.each([
    [MedicalDocumentFeedbackValue.Like, 'likes'],
    [MedicalDocumentFeedbackValue.Dislike, 'dislikes'],
  ])('increments only the global %s counter', async (value, field) => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const findByIdAndUpdate = jest.fn().mockReturnValue({ exec });
    const repository = new MongoMedicalDocumentFeedbackRepository({
      findByIdAndUpdate,
    } as never);

    await repository.increment(value);

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      'medical_document_ai_feedback',
      expect.objectContaining({ $inc: { [field]: 1 } }),
      { upsert: true },
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns the global totals and calculated approval rate', async () => {
    const exec = jest.fn().mockResolvedValue({ likes: 7, dislikes: 3 });
    const lean = jest.fn().mockReturnValue({ exec });
    const findById = jest.fn().mockReturnValue({ lean });
    const repository = new MongoMedicalDocumentFeedbackRepository({
      findById,
    } as never);

    await expect(repository.summary()).resolves.toEqual({
      likes: 7,
      dislikes: 3,
      total: 10,
      approvalRate: 70,
    });
  });

  it('returns zero values before the first response', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const lean = jest.fn().mockReturnValue({ exec });
    const findById = jest.fn().mockReturnValue({ lean });
    const repository = new MongoMedicalDocumentFeedbackRepository({
      findById,
    } as never);

    await expect(repository.summary()).resolves.toEqual({
      likes: 0,
      dislikes: 0,
      total: 0,
      approvalRate: 0,
    });
  });
});
