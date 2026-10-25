import { Logger } from '@nestjs/common';
import { OwnershipArchiveCapture } from '../../../src/context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchivePreparer } from '../../../src/context/animal-transfer/application/ownership-archive-preparer';
import {
  AnimalOwnershipControl,
  AnimalOwnershipRepository,
} from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { OwnershipArchiveSource } from '../../../src/context/animal-transfer/domain/ownership-archive-source';
import { DiaryEntryPrimitiveType } from '../../../src/context/diary/domain/diary-entry';
import { MedicalDocumentStatus } from '../../../src/context/medical-document/domain/medical-document';
import {
  archiveAnimal,
  archiveDefinition as definition,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const diary = (index: number): DiaryEntryPrimitiveType => ({
  id: `entry-${String(index).padStart(4, '0')}`,
  animalId: definition.animalId,
  title: 'Control',
  content: 'Conservar',
  date: '2020-01-01',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  attachments: [],
});

describe('Live ownership archive capture (internal)', () => {
  const setup = () => {
    const archives = new Map<string, OwnershipArchive>();
    const entries = new Map<string, ArchiveEntry>();
    const files = new Map<string, ArchiveFile>();
    const control: AnimalOwnershipControl = {
      animalId: definition.animalId,
      ownerId: definition.ownerId,
      ownershipVersion: 1,
      activeWrites: [],
    };
    const ownership = {
      findControl: jest.fn(() => Promise.resolve(clone(control))),
      acquireTransferLock: jest.fn<
        ReturnType<AnimalOwnershipRepository['acquireTransferLock']>,
        Parameters<AnimalOwnershipRepository['acquireTransferLock']>
      >((input) => {
        if (
          control.transferLock ||
          control.activeWrites?.length ||
          (control.uploadsValidUntil &&
            control.uploadsValidUntil > input.lockedAt) ||
          input.ownerId !== control.ownerId ||
          input.expectedOwnershipVersion !== control.ownershipVersion
        )
          return Promise.resolve(false);
        control.transferLock = {
          transferId: input.transferId,
          lockedAt: input.lockedAt,
        };
        return Promise.resolve(true);
      }),
      releaseTransferLock: jest.fn((animalId: string, transferId: string) => {
        if (
          animalId !== control.animalId ||
          transferId !== control.transferLock?.transferId
        )
          return Promise.resolve(false);
        delete control.transferLock;
        return Promise.resolve(true);
      }),
    };
    const records = {
      diaries: [] as DiaryEntryPrimitiveType[],
      medical: [archiveMedicalDocument()],
    };
    const source: jest.Mocked<OwnershipArchiveSource> = {
      findAnimal: jest.fn().mockResolvedValue(clone(archiveAnimal)),
      assertInitialPeriod: jest.fn().mockResolvedValue(undefined),
      hasPendingMedicalWork: jest.fn<Promise<boolean>, [string]>(() =>
        Promise.resolve(
          records.medical.some(
            (record) =>
              ![
                MedicalDocumentStatus.Accepted,
                MedicalDocumentStatus.Rejected,
                MedicalDocumentStatus.Failed,
              ].includes(record.status),
          ),
        ),
      ),
      listDiary: jest.fn((_id, after, limit) =>
        Promise.resolve(
          clone(
            records.diaries
              .filter((record) => !after || record.id > after)
              .slice(0, limit),
          ),
        ),
      ),
      listAcceptedDocuments: jest.fn((_id, after, limit) =>
        Promise.resolve(
          clone(
            records.medical
              .filter(
                (record) =>
                  record.status === MedicalDocumentStatus.Accepted &&
                  (!after || record.id > after),
              )
              .slice(0, limit),
          ),
        ),
      ),
    };
    const repository: jest.Mocked<OwnershipArchiveRepository> = {
      create: jest.fn((archive) => {
        if (!archives.has(archive.id)) archives.set(archive.id, clone(archive));
        return Promise.resolve(clone(archives.get(archive.id)!));
      }),
      find: jest.fn((id) => Promise.resolve(clone(archives.get(id) ?? null))),
      findEntry: jest.fn((_id, id) =>
        Promise.resolve(clone(entries.get(id) ?? null)),
      ),
      append: jest.fn((_id, entry, manifest) => {
        entries.set(entry.id, clone(entry));
        manifest.forEach((file) => files.set(file.id, clone(file)));
        return Promise.resolve();
      }),
      checkpointCapture: jest.fn((id, revision, next) => {
        const archive = archives.get(id)!;
        if (
          archive.state !== 'COLLECTING' ||
          archive.capture?.revision !== revision
        )
          return Promise.resolve(false);
        archive.capture = clone(next);
        return Promise.resolve(true);
      }),
      seal: jest.fn((id, count) => {
        if (
          entries.size !== count ||
          archives.get(id)!.capture?.phase !== 'COMPLETE'
        )
          return Promise.reject(new Error('Incomplete'));
        Object.assign(archives.get(id)!, {
          state: 'COPYING',
          expectedEntryCount: count,
          expectedFileCount: files.size,
        });
        return Promise.resolve();
      }),
      listEntries: jest.fn(),
      claimFile: jest.fn(),
      completeFile: jest.fn(),
      releaseFile: jest.fn(),
      markReadyIfComplete: jest.fn(),
    };
    const storage: jest.Mocked<OwnershipArchiveStorage> = {
      assertTransferSafe: jest.fn().mockResolvedValue(undefined),
      keyFromUrl: jest.fn((url) =>
        url.startsWith('https://test/')
          ? url.slice('https://test/'.length)
          : undefined,
      ),
      inspect: jest.fn().mockResolvedValue({
        etag: 'original',
        size: 12,
        versionId: 'version-1',
      }),
      copyAndVerify: jest.fn(),
    };
    const preparer = new OwnershipArchivePreparer(
      ownership as unknown as AnimalOwnershipRepository,
      repository,
      storage,
    );
    const instance = () =>
      new OwnershipArchiveCapture(
        ownership as unknown as AnimalOwnershipRepository,
        repository,
        source,
        storage,
        preparer,
      );
    return {
      service: instance(),
      instance,
      preparer,
      control,
      ownership,
      records,
      source,
      repository,
      storage,
      archives,
      entries,
      files,
    };
  };

  it('captures more than one page of diary and medicine, preserves identity/history/dates and seals the exact count without publishing', async () => {
    const ctx = setup();
    ctx.records.diaries = Array.from({ length: 120 }, (_, index) =>
      diary(index),
    );
    ctx.records.medical = Array.from({ length: 105 }, (_, index) =>
      archiveMedicalDocument(`document-${String(index).padStart(4, '0')}`),
    );
    await ctx.service.start(definition);
    expect(
      ctx.source.listAcceptedDocuments.mock.calls.map(([, after]) => after),
    ).toEqual([undefined, 'document-0099']);
    expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
    expect(ctx.entries.size).toBe(0);
    const counts: number[] = [];
    for (let step = 0; step < 6; step++)
      counts.push(
        (await ctx.service.captureBatch(definition.id)).capture!.entryCount,
      );
    expect(counts).toEqual([1, 101, 121, 221, 226, 226]);
    expect(ctx.archives.get(definition.id)).toMatchObject({
      state: 'COPYING',
      expectedEntryCount: 226,
      expectedFileCount: 105,
      capture: { phase: 'COMPLETE' },
    });
    expect(ctx.entries.size).toBe(226);
    const animal = [...ctx.entries.values()].find(
      (record) => record.kind === 'ANIMAL',
    )!;
    expect(animal.payload).toMatchObject({
      id: definition.animalId,
      ownerId: definition.ownerId,
      code: archiveAnimal.code,
      nameHistory: archiveAnimal.nameHistory,
    });
    expect(
      [...ctx.entries.values()].find(
        (record) => record.kind === 'MEDICAL_DOCUMENT',
      )!.payload,
    ).toMatchObject({
      documentCode: 'F-57-01',
      acceptedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(ctx.storage.copyAndVerify.mock.calls).toHaveLength(0);
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
    expect(ctx.control.transferLock?.transferId).toBe(definition.transferId);
    ctx.source.listDiary.mockClear();
    await ctx.instance().captureBatch(definition.id);
    expect(ctx.source.listDiary.mock.calls).toHaveLength(0);
  });

  it.each([
    MedicalDocumentStatus.PendingUpload,
    MedicalDocumentStatus.Analyzing,
    MedicalDocumentStatus.ReviewPending,
  ])(
    'denies %s (also replacements) before beginning and unlocks for the owner to resolve it',
    async (status) => {
      const ctx = setup();
      ctx.records.medical.push({
        ...archiveMedicalDocument('replacement'),
        status,
        replacementOfDocumentId: 'original',
      });
      await expect(ctx.service.start(definition)).rejects.toThrow(
        'Finish or discard',
      );
      expect(ctx.repository.create.mock.calls).toHaveLength(0);
      expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
      expect(ctx.control.transferLock).toBeUndefined();
      expect(ctx.records.medical[1].status).toBe(status);
    },
  );

  it('does not treat rejected/failed analysis as pending or archive its temporary artifacts', async () => {
    const ctx = setup();
    ctx.records.medical.push(
      {
        ...archiveMedicalDocument('failed'),
        status: MedicalDocumentStatus.Failed,
      },
      {
        ...archiveMedicalDocument('rejected'),
        status: MedicalDocumentStatus.Rejected,
      },
    );
    await ctx.service.start(definition);
    for (let step = 0; step < 4; step++)
      await ctx.service.captureBatch(definition.id);
    expect(ctx.entries.size).toBe(2);
    expect(ctx.files.size).toBe(1);
  });

  it('denies legacy multi-animal documents before beginning, unlocks, then permits retry after explicit normalization', async () => {
    const ctx = setup();
    ctx.records.medical[0].animalIds.push(definition.recipientId);
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'accepted independent document',
    );
    expect(ctx.control.transferLock).toBeUndefined();
    expect(ctx.archives.size).toBe(0);
    ctx.records.medical[0].animalIds = [definition.animalId];
    await ctx.service.start(definition);
    expect(ctx.archives.size).toBe(1);
  });

  it('does not silently skip an accepted record owned by another user', async () => {
    const ctx = setup();
    ctx.records.medical[0].ownerId = 'foreign';
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'accepted independent document',
    );
    expect(ctx.control.transferLock).toBeUndefined();
  });

  it.each(['writer', 'upload', 'reservation', 'version'] as const)(
    'does not begin or release anything when %s prevents acquisition',
    async (reason) => {
      const ctx = setup();
      if (reason === 'writer')
        ctx.control.activeWrites = [
          { token: 'other', startedAt: '2026-01-01' },
        ];
      if (reason === 'upload') ctx.control.uploadsValidUntil = '2999-01-01';
      if (reason === 'reservation')
        ctx.control.transferLock = {
          transferId: 'another',
          lockedAt: '2026-01-01',
        };
      if (reason === 'version') ctx.control.ownershipVersion = 2;
      await expect(ctx.service.start(definition)).rejects.toThrow(
        'busy or reserved',
      );
      expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
      expect(ctx.repository.create.mock.calls).toHaveLength(0);
    },
  );

  it('revalidates active status and owner after reservation and releases only its own denied preflight', async () => {
    const ctx = setup();
    ctx.source.findAnimal
      .mockResolvedValueOnce(archiveAnimal)
      .mockResolvedValueOnce({ ...archiveAnimal, isActive: false });
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'active animal and expected owner',
    );
    expect(ctx.ownership.releaseTransferLock).toHaveBeenCalledWith(
      definition.animalId,
      definition.transferId,
    );
    expect(ctx.archives.size).toBe(0);
  });

  it('fails closed if an initial period or retained-history precondition is not satisfied', async () => {
    const ctx = setup();
    ctx.source.assertInitialPeriod.mockRejectedValue(
      new Error('Retained ownership history capture is not implemented'),
    );
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'Retained ownership history',
    );
    expect(ctx.control.transferLock).toBeUndefined();
    expect(ctx.archives.size).toBe(0);
  });

  it('preserves the preflight denial if unlocking fails and reports recovery', async () => {
    const ctx = setup();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    ctx.source.hasPendingMedicalWork.mockResolvedValue(true);
    ctx.ownership.releaseTransferLock.mockRejectedValue(
      new Error('Mongo unavailable'),
    );
    try {
      await expect(ctx.service.start(definition)).rejects.toThrow(
        'Finish or discard',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('reservation recovery required'),
      );
      expect(ctx.control.transferLock).toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('never unlocks after begin was attempted with an uncertain persistence result', async () => {
    const ctx = setup();
    const create = ctx.repository.create.getMockImplementation()!;
    ctx.repository.create.mockImplementationOnce(async (archive) => {
      await create(archive);
      throw new Error('Acknowledgement lost');
    });
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'Acknowledgement lost',
    );
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
    await expect(ctx.instance().start(definition)).resolves.toMatchObject({
      capture: { phase: 'ANIMAL' },
    });
    expect(ctx.ownership.acquireTransferLock).toHaveBeenCalledTimes(1);
  });

  it('replays a partially appended page after restart without duplicating snapshots, manifests or S3 inspection', async () => {
    const ctx = setup();
    ctx.records.diaries = [diary(0), diary(1)];
    ctx.records.diaries[0].attachments.push({
      id: 'audio',
      fileName: 'audio.mp3',
      fileType: 'audio',
      mimeType: 'audio/mpeg',
      size: 12,
      createdAt: '2026-01-01',
      url: `https://test/users/${definition.ownerId}/animals/${definition.animalId}/diary/entry-0000/audio.mp3`,
    });
    await ctx.service.start(definition);
    await ctx.service.captureBatch(definition.id);
    const append = ctx.repository.append.getMockImplementation()!;
    ctx.repository.append
      .mockImplementationOnce(append)
      .mockRejectedValueOnce(new Error('Interrupted mid-page'));
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'Interrupted mid-page',
    );
    expect(ctx.archives.get(definition.id)!.capture!.entryCount).toBe(1);
    expect(ctx.entries.size).toBe(2);
    await ctx.instance().captureBatch(definition.id);
    expect(ctx.entries.size).toBe(3);
    expect(ctx.files.size).toBe(1);
    expect(ctx.storage.inspect.mock.calls).toHaveLength(1);
    expect(ctx.archives.get(definition.id)!.capture!.entryCount).toBe(3);
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
  });

  it('replays a page if checkpoint acknowledgement failed and never regresses a concurrently advanced cursor', async () => {
    const ctx = setup();
    await ctx.service.start(definition);
    ctx.repository.checkpointCapture.mockRejectedValueOnce(
      new Error('Checkpoint failed'),
    );
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'Checkpoint failed',
    );
    expect(ctx.entries.size).toBe(1);
    expect(ctx.archives.get(definition.id)!.capture!.entryCount).toBe(0);
    await ctx.instance().captureBatch(definition.id);
    const revision = ctx.archives.get(definition.id)!.capture!.revision;
    // Both callers can read the same revision; only one advances it.
    await Promise.all([
      ctx.instance().captureBatch(definition.id),
      ctx.instance().captureBatch(definition.id),
    ]);
    expect(ctx.archives.get(definition.id)!.capture!.revision).toBe(
      revision + 1,
    );
    expect(ctx.entries.size).toBe(1);
  });

  it('handles exact page boundaries and an empty animal dossier without premature sealing', async () => {
    const ctx = setup();
    ctx.records.medical = [];
    ctx.records.diaries = Array.from({ length: 100 }, (_, index) =>
      diary(index),
    );
    await ctx.service.start(definition);
    await ctx.service.captureBatch(definition.id);
    await ctx.service.captureBatch(definition.id);
    expect(ctx.archives.get(definition.id)!.capture).toMatchObject({
      phase: 'DIARY',
      afterId: 'entry-0099',
      entryCount: 101,
    });
    await ctx.service.captureBatch(definition.id);
    await ctx.service.captureBatch(definition.id);
    await ctx.service.captureBatch(definition.id);
    expect(ctx.archives.get(definition.id)).toMatchObject({
      state: 'COPYING',
      expectedEntryCount: 101,
    });
    const empty = setup();
    empty.records.medical = [];
    await empty.service.start(definition);
    for (let step = 0; step < 4; step++)
      await empty.service.captureBatch(definition.id);
    expect(empty.archives.get(definition.id)).toMatchObject({
      state: 'COPYING',
      expectedEntryCount: 1,
      expectedFileCount: 0,
    });
  });

  it('refuses a lost lock or unexpected pending work after capture has started without releasing its reservation', async () => {
    const ctx = setup();
    await ctx.service.start(definition);
    ctx.source.hasPendingMedicalWork.mockResolvedValueOnce(true);
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'Finish or discard',
    );
    ctx.control.transferLock!.transferId = 'different';
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'matching drained',
    );
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
    expect(ctx.entries.size).toBe(0);
  });

  it('does not join a matching reservation without a header or change the capture definition', async () => {
    const ctx = setup();
    ctx.control.transferLock = {
      transferId: definition.transferId,
      lockedAt: '2026-01-01',
    };
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'busy or reserved',
    );
    delete ctx.control.transferLock;
    await ctx.service.start(definition);
    await expect(
      ctx.service.start({ ...definition, recipientId: definition.periodId }),
    ).rejects.toThrow('different capture definition');
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
  });

  it('rejects a repeated/descending source cursor instead of looping or sealing an incomplete dossier', async () => {
    const ctx = setup();
    ctx.source.listAcceptedDocuments.mockResolvedValue([
      archiveMedicalDocument('same'),
      archiveMedicalDocument('same'),
    ]);
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'cursor did not advance',
    );
    expect(ctx.archives.size).toBe(0);
    expect(ctx.control.transferLock).toBeUndefined();
  });

  it('keeps the captured profile and resumable cursor immutable when live content unexpectedly changes mid-page', async () => {
    const ctx = setup();
    await ctx.service.start(definition);
    ctx.repository.checkpointCapture.mockRejectedValueOnce(
      new Error('Checkpoint failed'),
    );
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'Checkpoint failed',
    );
    ctx.source.findAnimal.mockResolvedValue({
      ...archiveAnimal,
      name: 'Unexpected later edit',
    });
    await expect(ctx.instance().captureBatch(definition.id)).rejects.toThrow(
      'cannot be overwritten',
    );
    expect([...ctx.entries.values()][0].payload.name).toBe(archiveAnimal.name);
    expect(ctx.archives.get(definition.id)!.capture!.revision).toBe(0);
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
  });

  it.each(['profile', 'diary'] as const)(
    'denies unsealed/legacy %s before creating an archive and unlocks for explicit migration',
    async (kind) => {
      const ctx = setup();
      const url = `https://test/users/${definition.ownerId}/animals/${definition.animalId}/${kind === 'profile' ? 'profile_100.jpeg' : 'diary/entry-0000/photo.jpg'}`;
      if (kind === 'profile')
        ctx.source.findAnimal.mockResolvedValue({
          ...archiveAnimal,
          profilePictureUrl: url,
        });
      else {
        const entry = diary(0);
        entry.attachments.push({
          id: 'photo',
          fileName: 'photo.jpg',
          fileType: 'image',
          mimeType: 'image/jpeg',
          size: 12,
          createdAt: '2026-01-01',
          url,
        });
        ctx.records.diaries.push(entry);
      }
      ctx.storage.assertTransferSafe.mockRejectedValue(
        new Error('Legacy media must be migrated'),
      );
      await expect(ctx.service.start(definition)).rejects.toThrow(
        'must be migrated',
      );
      expect(ctx.archives.size).toBe(0);
      expect(ctx.control.transferLock).toBeUndefined();
      expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
    },
  );

  it('does not adopt a manually assembled archive or invent a cursor for it', async () => {
    const ctx = setup();
    await ctx.service.start(definition);
    delete ctx.archives.get(definition.id)!.capture;
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'different capture definition or mode',
    );
    await expect(ctx.service.captureBatch(definition.id)).rejects.toThrow(
      'valid live capture progress',
    );
    expect(ctx.entries.size).toBe(0);
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
  });

  it('leaves acquisition with an unknown outcome for recovery without beginning or unlocking', async () => {
    const ctx = setup();
    ctx.ownership.acquireTransferLock.mockImplementationOnce((input) => {
      ctx.control.transferLock = {
        transferId: input.transferId,
        lockedAt: input.lockedAt,
      };
      return Promise.reject(new Error('Majority acknowledgement lost'));
    });
    await expect(ctx.service.start(definition)).rejects.toThrow(
      'Majority acknowledgement lost',
    );
    expect(ctx.repository.create.mock.calls).toHaveLength(0);
    expect(ctx.ownership.releaseTransferLock).not.toHaveBeenCalled();
    await expect(ctx.instance().start(definition)).rejects.toThrow(
      'busy or reserved',
    );
  });
});
