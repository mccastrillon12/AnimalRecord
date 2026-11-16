import { AnimalPrimitiveType } from '../../../src/context/animal/domain/animal';
import { ArchiveDefinition } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';

export const archiveDefinition: ArchiveDefinition = {
  id: '123e4567-e89b-42d3-a456-426614174020',
  animalId: '123e4567-e89b-42d3-a456-426614174010',
  ownerId: '123e4567-e89b-42d3-a456-426614174001',
  recipientId: '123e4567-e89b-42d3-a456-426614174002',
  periodId: '123e4567-e89b-42d3-a456-426614174030',
  transferId: '123e4567-e89b-42d3-a456-426614174040',
  ownershipVersion: 1,
};
export const archiveAnimal: AnimalPrimitiveType = {
  id: archiveDefinition.animalId,
  ownerId: archiveDefinition.ownerId,
  name: 'Brownie',
  species: 'DOG',
  breed: 'Labrador',
  code: 'AR-C001',
  sex: 'MALE',
  reproductiveStatus: 'NEUTERED',
  hasChip: false,
  isAssociationMember: false,
  temperament: [],
  diagnosis: [],
  nameHistory: [{ name: 'Brownie', date: '2026-01-01T00:00:00.000Z' }],
};

export const archiveMedicalDocument = (
  id = 'document-001',
): MedicalDocumentPrimitiveType => {
  const storageKey = `users/${archiveDefinition.ownerId}/animals/${archiveDefinition.animalId}/medical-documents/prescriptions/${id}/revisions/2/source.pdf`;
  return {
    id,
    ownerId: archiveDefinition.ownerId,
    animalIds: [archiveDefinition.animalId],
    documentGroupId: 'original-group',
    originalFileName: 'formula.pdf',
    mimeType: 'application/pdf',
    fileSize: 12,
    storageKey,
    documentLocations: [{ animalId: archiveDefinition.animalId, storageKey }],
    status: MedicalDocumentStatus.Accepted,
    finalCategory: MedicalDocumentType.Prescription,
    detectedCategories: [],
    extractionsByCategory: {},
    version: 2,
    documentCode: 'F-57-01',
    acceptedAt: '2026-10-25T10:00:00.000Z',
    createdAt: '2026-10-25T09:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    assignments: [
      { animalId: archiveDefinition.animalId, extractedItemIds: [] },
    ],
    validatedExtraction: {
      documentType: MedicalDocumentType.Prescription,
      patientHints: [],
      diagnoses: [],
      medications: [],
      vaccinations: [],
      medicalOrders: [],
      additionalFields: {},
      warnings: [],
    },
  };
};
