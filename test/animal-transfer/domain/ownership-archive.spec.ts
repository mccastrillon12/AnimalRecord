import {
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import {
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  archiveAnimal,
  archiveDefinition,
} from '../fixtures/ownership-archive.fixture';
const prefix = `users/${archiveDefinition.ownerId}/animals/${archiveDefinition.animalId}/`;
const getKey = (url: string) =>
  url.startsWith('https://test/')
    ? url.slice('https://test/'.length)
    : undefined;

describe('Ownership archive snapshots', () => {
  it('preserves names, identity and an independent JSON snapshot', () => {
    const input = {
      ...archiveAnimal,
      nameHistory: [...archiveAnimal.nameHistory!],
    };
    const { entry } = buildArchiveEntry(
      archiveDefinition,
      { kind: 'ANIMAL', data: input },
      getKey,
    );
    const firstHash = entry.contentHash;
    input.nameHistory[0] = {
      name: 'Later name',
      date: '2027-01-01T00:00:00.000Z',
    };
    input.name = 'Later name';
    expect(entry.payload.name).toBe('Brownie');
    expect(entry.payload.nameHistory).toEqual(archiveAnimal.nameHistory);
    expect(entry.payload.id).toBe(archiveAnimal.id);
    expect(entry.payload.code).toBe(archiveAnimal.code);
    expect(entry.contentHash).toBe(firstHash);
    expect(archiveHash({ a: 1, b: 2 })).toBe(archiveHash({ b: 2, a: 1 }));
  });

  it('preserves diary photo/audio subdirectories with isolated deterministic destinations', () => {
    const { files, entry } = buildArchiveEntry(
      archiveDefinition,
      {
        kind: 'DIARY_ENTRY',
        data: {
          id: 'entry-1',
          animalId: archiveDefinition.animalId,
          title: 'Control',
          date: '2026-01-01',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          attachments: [
            {
              id: 'photo',
              fileName: 'photo.jpg',
              fileType: 'image',
              mimeType: 'image/jpeg',
              url: `https://test/${prefix}diary/entry-1/photo.jpg`,
              size: 12,
              createdAt: '2026-01-01',
            },
            {
              id: 'audio',
              fileName: 'audio.mp3',
              fileType: 'audio',
              mimeType: 'audio/mpeg',
              url: `https://test/${prefix}diary/entry-1/audio.mp3`,
              size: 24,
              createdAt: '2026-01-01',
            },
          ],
        },
      },
      getKey,
    );
    expect(files).toHaveLength(2);
    expect(files[0].relativeKey).toBe('diary/entry-1/photo.jpg');
    expect(files[0].historicalKey).toBe(
      `${prefix}ownership-archives/${archiveDefinition.id}/diary/entry-1/photo.jpg`,
    );
    expect(files[1].recipientFinalKey).toBe(
      `users/${archiveDefinition.recipientId}/animals/${archiveDefinition.animalId}/diary/entry-1/audio.mp3`,
    );
    expect(files[1].recipientStagingKey).not.toBe(files[1].recipientFinalKey);
    expect(entry.fileBindings.map((binding) => binding.path)).toEqual([
      '/attachments/0/url',
      '/attachments/1/url',
    ]);
  });

  const medical = (): MedicalDocumentPrimitiveType => ({
    id: 'document-1',
    ownerId: archiveDefinition.ownerId,
    animalIds: [archiveDefinition.animalId],
    originalFileName: 'formula.pdf',
    mimeType: 'application/pdf',
    fileSize: 12,
    storageKey: `${prefix}medical-documents/prescriptions/document-1/revisions/2/source.pdf`,
    documentLocations: [
      {
        animalId: archiveDefinition.animalId,
        storageKey: `${prefix}medical-documents/prescriptions/document-1/revisions/2/source.pdf`,
      },
    ],
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
  });

  it('deduplicates medical file references and preserves code, first acceptance and extraction', () => {
    const document = medical();
    const { entry, files } = buildArchiveEntry(
      archiveDefinition,
      { kind: 'MEDICAL_DOCUMENT', data: document },
      getKey,
    );
    expect(files).toHaveLength(1);
    expect(entry.fileBindings).toHaveLength(2);
    expect(entry.payload.documentCode).toBe('F-57-01');
    expect(entry.payload.acceptedAt).toBe(document.acceptedAt);
    expect(entry.payload.validatedExtraction).toEqual(
      document.validatedExtraction,
    );
    expect(files[0].relativeKey).toContain(
      'prescriptions/document-1/revisions/2/',
    );
  });

  it.each(['pending', 'multi-animal', 'foreign-owner', 'foreign-assignment'])(
    'rejects an unsafe medical snapshot: %s',
    (scenario) => {
      const document = medical();
      if (scenario === 'pending')
        document.status = MedicalDocumentStatus.ReviewPending;
      if (scenario === 'multi-animal')
        document.animalIds.push('another-animal');
      if (scenario === 'foreign-owner')
        document.ownerId = archiveDefinition.recipientId;
      if (scenario === 'foreign-assignment')
        document.assignments[0].animalId = 'another-animal';
      expect(() =>
        buildArchiveEntry(
          archiveDefinition,
          { kind: 'MEDICAL_DOCUMENT', data: document },
          getKey,
        ),
      ).toThrow('independent document');
    },
  );

  it.each([
    'https://foreign/file.jpg',
    `https://test/users/other/animals/${archiveDefinition.animalId}/profile.jpg`,
    `https://test/${prefix}../private.jpg`,
    `https://test/${prefix}ownership-archives/old/profile.jpg`,
    `https://test/${prefix}upload-intake/upload/source`,
  ])('rejects a foreign or retained source: %s', (url) => {
    expect(() =>
      buildArchiveEntry(
        archiveDefinition,
        { kind: 'ANIMAL', data: { ...archiveAnimal, profilePictureUrl: url } },
        getKey,
      ),
    ).toThrow();
  });
});
