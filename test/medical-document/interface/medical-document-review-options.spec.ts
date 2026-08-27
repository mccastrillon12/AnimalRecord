import {
  MEDICAL_DOCUMENT_REJECTION_REASON_OPTIONS,
  MedicalDocumentRejectionReasonOptionDto,
} from '../../../src/app/medical-document/medical-document-review-options.dto';
import { MedicalDocumentRejectionReason } from '../../../src/context/medical-document/domain/medical-document';

describe('Medical document rejection reason options', () => {
  it('returns stable codes and the labels required by the dropdown', () => {
    expect(MEDICAL_DOCUMENT_REJECTION_REASON_OPTIONS).toEqual<
      MedicalDocumentRejectionReasonOptionDto[]
    >([
      {
        code: MedicalDocumentRejectionReason.IncorrectInformation,
        label: 'Información incorrecta',
        requiresComment: false,
      },
      {
        code: MedicalDocumentRejectionReason.WrongAnimal,
        label: 'El archivo no es el correspondiente al animal',
        requiresComment: false,
      },
      {
        code: MedicalDocumentRejectionReason.Other,
        label: 'Otros',
        requiresComment: true,
      },
    ]);
  });
});
