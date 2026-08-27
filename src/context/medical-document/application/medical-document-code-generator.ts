import { Injectable } from '@nestjs/common';
import { MongoCounterRepository } from '../../shared/infrastructure/persistence/mongo/mongo-counter-repository';
import {
  MedicalDocumentCode,
  MedicalDocumentType,
  medicalDocumentCodePrefix,
} from '../domain/medical-document';

const COUNTRY_CODE = '57';

@Injectable()
export class MedicalDocumentCodeGenerator {
  constructor(private readonly counterRepository: MongoCounterRepository) {}

  async generate(
    category: MedicalDocumentType,
  ): Promise<MedicalDocumentCode | undefined> {
    const prefix = medicalDocumentCodePrefix(category);
    if (!prefix) return undefined;

    const sequence = await this.counterRepository.getNextSequence(
      `medical_document_code_${COUNTRY_CODE}_${category}`,
    );
    const formattedSequence = sequence.toString().padStart(2, '0');

    return {
      value: `${prefix}-${COUNTRY_CODE}-${formattedSequence}`,
      sequence,
      countryCode: COUNTRY_CODE,
    };
  }
}
