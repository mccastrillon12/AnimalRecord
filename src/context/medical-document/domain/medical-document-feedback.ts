export enum MedicalDocumentFeedbackValue {
  Like = 'LIKE',
  Dislike = 'DISLIKE',
}

export type MedicalDocumentFeedbackSummary = {
  likes: number;
  dislikes: number;
  total: number;
  approvalRate: number;
};

export interface MedicalDocumentFeedbackRepository {
  increment(value: MedicalDocumentFeedbackValue): Promise<void>;
  summary(): Promise<MedicalDocumentFeedbackSummary>;
}
