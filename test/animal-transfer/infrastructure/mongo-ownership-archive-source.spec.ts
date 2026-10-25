import { MongoOwnershipArchiveSource } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import { AnimalOwnershipPeriodStatus } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MedicalDocumentStatus } from '../../../src/context/medical-document/domain/medical-document';
import {
  archiveAnimal,
  archiveDefinition as definition,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';

const query = <T>(data: T) => {
  const chain = {
    sort: jest.fn(),
    limit: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(data),
  };
  for (const method of [
    chain.sort,
    chain.limit,
    chain.read,
    chain.readConcern,
    chain.lean,
  ])
    method.mockReturnValue(chain);
  return chain;
};

describe('Mongo live dossier source (read only)', () => {
  const setup = () => {
    const animalRead = query({ ...archiveAnimal, _id: 'mongo-only', __v: 9 });
    const diaryRead = query([
      {
        id: definition.periodId,
        animalId: definition.animalId,
        title: 'Control',
        date: '2020-01-01',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        attachments: [],
      },
    ]);
    const medicalRead = query([archiveMedicalDocument()]);
    const pendingRead = query(null as unknown);
    const periodRead = query({ id: definition.periodId });
    const previousRead = query(null as unknown);
    const animals = { findOne: jest.fn().mockReturnValue(animalRead) };
    const diary = { find: jest.fn().mockReturnValue(diaryRead) };
    const medical = {
      find: jest.fn().mockReturnValue(medicalRead),
      exists: jest.fn().mockReturnValue(pendingRead),
    };
    const periods = {
      findOne: jest.fn().mockReturnValue(periodRead),
      exists: jest.fn().mockReturnValue(previousRead),
    };
    return {
      source: new MongoOwnershipArchiveSource(
        animals as never,
        diary as never,
        medical as never,
        periods as never,
      ),
      animals,
      diary,
      medical,
      periods,
      animalRead,
      diaryRead,
      medicalRead,
      pendingRead,
      periodRead,
      previousRead,
    };
  };

  it('reads the complete visible animal data without Mongo internals and preserves names, code and unknown dates', async () => {
    const ctx = setup();
    const animal = await ctx.source.findAnimal(definition.animalId);
    expect(animal).toMatchObject(archiveAnimal);
    expect(animal).not.toHaveProperty('_id');
    expect(animal).not.toHaveProperty('__v');
    expect(animal?.createdAt).toBeUndefined();
    expect(ctx.animals.findOne).toHaveBeenCalledWith({
      id: definition.animalId,
    });
    expect(ctx.animalRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.animalRead.readConcern).toHaveBeenCalledWith('majority');
    ctx.animalRead.exec.mockResolvedValueOnce(null);
    await expect(
      ctx.source.findAnimal(definition.animalId),
    ).resolves.toBeNull();
  });

  it('requires the exact initial active period and checks for any retained closed period', async () => {
    const ctx = setup();
    await ctx.source.assertInitialPeriod(definition);
    expect(ctx.periods.findOne).toHaveBeenCalledWith({
      id: definition.periodId,
      animalId: definition.animalId,
      ownerId: definition.ownerId,
      ownershipVersion: 1,
      status: AnimalOwnershipPeriodStatus.Active,
    });
    expect(ctx.periods.exists).toHaveBeenCalledWith({
      animalId: definition.animalId,
      status: AnimalOwnershipPeriodStatus.Closed,
    });
    for (const read of [ctx.periodRead, ctx.previousRead]) {
      expect(read.read).toHaveBeenCalledWith('primary');
      expect(read.readConcern).toHaveBeenCalledWith('majority');
    }
  });

  it('refuses a missing or inconsistent active period without guessing ownership', async () => {
    const ctx = setup();
    ctx.periodRead.exec.mockResolvedValue(null);
    await expect(ctx.source.assertInitialPeriod(definition)).rejects.toThrow(
      'active ownership period',
    );
    expect(ctx.periods.exists).not.toHaveBeenCalled();
  });

  it('refuses later ownership versions and any prior closed period until retained history can be imported', async () => {
    const ctx = setup();
    await expect(
      ctx.source.assertInitialPeriod({ ...definition, ownershipVersion: 2 }),
    ).rejects.toThrow('Retained ownership history');
    expect(ctx.periods.findOne).not.toHaveBeenCalled();
    ctx.previousRead.exec.mockResolvedValue({ _id: 'closed-period' });
    await expect(ctx.source.assertInitialPeriod(definition)).rejects.toThrow(
      'Retained ownership history',
    );
  });

  it('checks every unfinished/unknown medical status, including replacement candidates and inconsistent owners', async () => {
    const ctx = setup();
    await expect(
      ctx.source.hasPendingMedicalWork(definition.animalId),
    ).resolves.toBe(false);
    expect(ctx.medical.exists).toHaveBeenCalledWith({
      animalIds: definition.animalId,
      status: {
        $nin: [
          MedicalDocumentStatus.Accepted,
          MedicalDocumentStatus.Rejected,
          MedicalDocumentStatus.Failed,
        ],
      },
    });
    // No owner/replacement/category/group filter may hide a pending association.
    ctx.pendingRead.exec.mockResolvedValue({ _id: 'pending-replacement' });
    await expect(
      ctx.source.hasPendingMedicalWork(definition.animalId),
    ).resolves.toBe(true);
    expect(ctx.pendingRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.pendingRead.readConcern).toHaveBeenCalledWith('majority');
  });

  it('paginates diary by persisted id, not clinical dates or skip, with majority primary reads', async () => {
    const ctx = setup();
    const result = await ctx.source.listDiary(
      definition.animalId,
      'cursor',
      100,
    );
    expect(ctx.diary.find).toHaveBeenCalledWith({
      animalId: definition.animalId,
      id: { $gt: 'cursor' },
    });
    expect(ctx.diaryRead.sort).toHaveBeenCalledWith({ id: 1 });
    expect(ctx.diaryRead.limit).toHaveBeenCalledWith(100);
    expect(ctx.diaryRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.diaryRead.readConcern).toHaveBeenCalledWith('majority');
    expect(result[0]).toMatchObject({
      date: '2020-01-01',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });
    await ctx.source.listDiary(definition.animalId, undefined, 1);
    expect(ctx.diary.find).toHaveBeenLastCalledWith({
      animalId: definition.animalId,
    });
  });

  it('enumerates accepted medicine without owner/category/group/date filters that could silently omit records', async () => {
    const ctx = setup();
    const result = await ctx.source.listAcceptedDocuments(
      definition.animalId,
      'cursor',
      100,
    );
    expect(ctx.medical.find).toHaveBeenCalledWith({
      animalIds: definition.animalId,
      status: MedicalDocumentStatus.Accepted,
      id: { $gt: 'cursor' },
    });
    expect(ctx.medicalRead.sort).toHaveBeenCalledWith({ id: 1 });
    expect(ctx.medicalRead.limit).toHaveBeenCalledWith(100);
    expect(ctx.medicalRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.medicalRead.readConcern).toHaveBeenCalledWith('majority');
    expect(result[0]).toMatchObject({
      documentCode: 'F-57-01',
      acceptedAt: '2026-10-25T10:00:00.000Z',
      version: 2,
    });
    await ctx.source.listAcceptedDocuments(definition.animalId, undefined, 1);
    expect(ctx.medical.find).toHaveBeenLastCalledWith({
      animalIds: definition.animalId,
      status: MedicalDocumentStatus.Accepted,
    });
  });

  it.each([0, 101, 1.5, NaN])(
    'rejects invalid page size %s before reading collections',
    async (limit) => {
      const ctx = setup();
      await expect(
        ctx.source.listDiary(definition.animalId, undefined, limit),
      ).rejects.toThrow('page size');
      await expect(
        ctx.source.listAcceptedDocuments(definition.animalId, undefined, limit),
      ).rejects.toThrow('page size');
      expect(ctx.diary.find).not.toHaveBeenCalled();
      expect(ctx.medical.find).not.toHaveBeenCalled();
    },
  );
});
