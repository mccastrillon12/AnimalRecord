import { buildArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { projectPublishedHistoryEntry } from '../../../src/context/animal-transfer/domain/published-ownership-history';
import {
  archiveDefinition,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';

describe('Published medical history uploader', () => {
  it('exposes captured uploader data independently of the period owner without exposing storage or provider metadata', () => {
    const original = archiveMedicalDocument();
    const uploadedBy = {
      id: archiveDefinition.recipientId,
      name: 'Quien subió el documento',
      uploadedAt: original.createdAt,
    };
    const { entry } = buildArchiveEntry(
      archiveDefinition,
      {
        kind: 'MEDICAL_DOCUMENT',
        data: { ...original, uploadedBy },
      },
      () => undefined,
    );
    const before = structuredClone(entry);
    const { data } = projectPublishedHistoryEntry(entry);
    expect(data.uploadedBy).toEqual(uploadedBy);
    expect(data.ownerId).toBe(archiveDefinition.ownerId);
    expect(data).not.toHaveProperty('storageKey');
    expect(data).not.toHaveProperty('documentLocations');
    expect(data).not.toHaveProperty('providerMetadata');
    (data.uploadedBy as typeof uploadedBy).name = 'Nombre posterior';
    expect(entry).toEqual(before);
  });

  it('keeps legacy uploader absence instead of attributing the file to the period owner', () => {
    const { entry } = buildArchiveEntry(
      archiveDefinition,
      { kind: 'MEDICAL_DOCUMENT', data: archiveMedicalDocument() },
      () => undefined,
    );
    expect(projectPublishedHistoryEntry(entry).data).not.toHaveProperty(
      'uploadedBy',
    );
  });
});
