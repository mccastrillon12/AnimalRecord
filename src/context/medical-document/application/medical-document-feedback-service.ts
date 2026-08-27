import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocumentFeedbackRepository,
  MedicalDocumentFeedbackSummary,
  MedicalDocumentFeedbackValue,
} from '../domain/medical-document-feedback';

@Injectable()
export class MedicalDocumentFeedbackService {
  constructor(
    @Inject('MedicalDocumentFeedbackRepository')
    private readonly repository: MedicalDocumentFeedbackRepository,
  ) {}

  async record(value: MedicalDocumentFeedbackValue): Promise<void> {
    await this.repository.increment(value);
  }

  async summary(): Promise<MedicalDocumentFeedbackSummary> {
    return this.repository.summary();
  }
}
