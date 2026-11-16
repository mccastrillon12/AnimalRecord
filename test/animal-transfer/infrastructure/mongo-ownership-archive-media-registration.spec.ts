import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { OwnershipArchiveMediaRegistrar } from '../../../src/context/animal-transfer/application/ownership-archive-media-registrar';
import { ArchiveMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { MongoOwnershipArchiveMediaRegistration } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-media-registration';
import {
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
  OwnershipArchiveMediaRegistrationSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';
import { registrationFixture } from '../fixtures/ownership-archive-media-registration.fixture';
import { historyClone as clone } from '../fixtures/ownership-archive-history.fixture';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import { LegacyAnimalMediaCopier } from '../../../src/context/animal-media/application/legacy-animal-media-copier';

// Small optimistic transaction double. Does not prove Mongo rollback/majority/indices.
type Snapshot = { rows: ArchiveMediaRegistration[]; epoch: number };
const query = <T>(read: (snapshot?: Snapshot) => T) => {
  let snapshot: Snapshot | undefined;
  const q = {
    session: jest.fn(),
    lean: jest.fn(),
    select: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn(() => Promise.resolve(clone(read(snapshot)))),
  };
  q.session.mockImplementation((session: { current: Snapshot }) => {
    snapshot = session.current;
    return q;
  });
  q.lean.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  return q;
};

describe('Mongo immutable media registration', () => {
  const setup = (
    kind: 'PROFILE' | 'DIARY' | 'MEDICAL' | 'RETAINED' = 'MEDICAL',
  ) => {
    const fixture = registrationFixture(kind);
    const state = {
      rows: [] as ArchiveMediaRegistration[],
      epoch: 0,
      active: true,
      control: true,
      archive: true,
      file: true,
      plan: true,
      loseReply: false,
      createError: undefined as Error | undefined,
      beforeCreate: undefined as (() => void) | undefined,
    };
    const commit = jest.fn();
    const sessions: Array<{
      current: Snapshot;
      endSession: jest.Mock;
      withTransaction: jest.Mock;
    }> = [];
    const startSession = jest.fn(() => {
      const session = {
        current: { rows: [], epoch: 0 } as Snapshot,
        endSession: jest.fn().mockResolvedValue(undefined),
        withTransaction: jest.fn(
          async (work: () => Promise<ArchiveMediaRegistration>) => {
            for (let attempt = 0; attempt < 5; attempt++) {
              session.current = { rows: clone(state.rows), epoch: state.epoch };
              const result = await work();
              if (session.current.epoch !== state.epoch) continue;
              state.rows = session.current.rows;
              state.epoch++;
              commit();
              if (state.loseReply) {
                state.loseReply = false;
                throw new Error('commit reply lost after durable evidence');
              }
              return result;
            }
            throw new Error('snapshot retries exhausted');
          },
        ),
      };
      sessions.push(session);
      return Promise.resolve(session);
    });
    const archives = {
      db: { startSession },
      findOne: jest.fn(() =>
        query(() => (state.archive ? fixture.archive : null)),
      ),
    };
    const files = {
      findOne: jest.fn(() => query(() => (state.file ? fixture.file : null))),
    };
    const entries = {
      findOne: jest.fn(() => query(() => (state.plan ? fixture.entry : null))),
    };
    const controls = {
      updateOne: jest.fn(() =>
        query(() => ({ modifiedCount: state.control ? 1 : 0 })),
      ),
    };
    const periods = {
      exists: jest.fn(() =>
        query(() => (state.active ? { _id: 'active' } : null)),
      ),
    };
    const registrations = {
      // Adapter supplies only the identity/key collision query, checked separately below.
      find: jest.fn(() => query((snapshot) => snapshot!.rows.slice(0, 2))),
      create: jest.fn(
        (
          rows: ArchiveMediaRegistration[],
          options: { session: { current: Snapshot } },
        ) => {
          state.beforeCreate?.();
          if (state.createError) throw state.createError;
          options.session.current.rows.push(...clone(rows));
          return Promise.resolve(clone(rows));
        },
      ),
    };
    const repository = new MongoOwnershipArchiveMediaRegistration(
      archives as never,
      entries as never,
      files as never,
      registrations as never,
      controls as never,
      periods as never,
    );
    const register = () =>
      repository.registerFile(fixture.archive.id, fixture.file.id);
    return {
      ...fixture,
      state,
      commit,
      sessions,
      archives,
      files,
      entries,
      controls,
      periods,
      registrations,
      repository,
      register,
    };
  };
  it.each(['PROFILE', 'DIARY'] as const)(
    'a successfully registered %s remains unusable by upload/legacy/capture protocols',
    async (kind) => {
      const s = setup(kind);
      const record = await s.register();
      expect(s.state.rows).toEqual([record]);
      const ordinaryRepository = {
        create: jest.fn(),
        find: jest.fn(),
        findLegacySource: jest.fn(),
        pin: jest.fn(),
        seal: jest.fn(),
      };
      const ordinaryStorage = {
        keyFromUrl: (url: string) => url.slice('https://test/'.length),
        urlForKey: (key: string) => `https://test/${key}`,
        signStaging: jest.fn(),
        describeSource: jest.fn(),
        pinSource: jest.fn(),
        promote: jest.fn(),
        verifyFinal: jest.fn(),
      };
      const uploads = new AnimalMediaUploads(
        ordinaryRepository,
        ordinaryStorage,
      );
      const url = ordinaryStorage.urlForKey(record.key);
      await expect(
        uploads.confirm(
          record.recipientId,
          record.animalId,
          url,
          undefined,
          undefined,
          url,
        ),
      ).rejects.toThrow('cannot be activated');
      await expect(uploads.inspectSealed(record.key)).rejects.toThrow(
        'cannot be activated',
      );
      await expect(uploads.assertRegisteredSealed(record.key)).rejects.toThrow(
        'cannot be activated',
      );
      await expect(
        uploads.issue(
          record.recipientId,
          record.animalId,
          record.key,
          'image/png',
          12,
        ),
      ).rejects.toThrow('Invalid animal upload');
      await expect(
        new LegacyAnimalMediaCopier(
          ordinaryRepository,
          ordinaryStorage,
        ).prepare(
          {
            id: s.archive.transferId,
            animalId: record.animalId,
            ownerId: record.recipientId,
            ownershipVersion: 2,
            phase: 'PROFILE',
            revision: 0,
          },
          { kind, url },
        ),
      ).rejects.toThrow('cannot be migrated as legacy');
      expect(ordinaryRepository.create).not.toHaveBeenCalled();
      expect(ordinaryRepository.find).not.toHaveBeenCalled();
      expect(ordinaryStorage.signStaging).not.toHaveBeenCalled();
      expect(ordinaryStorage.promote).not.toHaveBeenCalled();
      expect(ordinaryStorage.verifyFinal).not.toHaveBeenCalled();
      expect(s.state.rows).toEqual([record]);
    },
  );
  it('writes only evidence and the shared control fence in a majority snapshot transaction', async () => {
    const s = setup();
    const before = clone([s.archive, s.entry, s.file]);
    await expect(s.register()).resolves.toEqual(s.registration);
    expect(s.state.rows).toEqual([s.registration]);
    expect([s.archive, s.entry, s.file]).toEqual(before);
    const session = s.sessions[0];
    expect(session.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
    expect(s.controls.updateOne).toHaveBeenCalledWith(
      {
        animalId: s.archive.animalId,
        ownerId: s.archive.ownerId,
        ownershipVersion: s.archive.ownershipVersion,
        'transferLock.transferId': s.archive.transferId,
        reservationEpoch: 1,
        $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
      },
      { $inc: { archiveMaterializationRevision: 1 } },
      { session },
    );
    expect(s.periods.exists).toHaveBeenCalledWith({
      id: s.archive.periodId,
      animalId: s.archive.animalId,
      ownerId: s.archive.ownerId,
      ownershipVersion: s.archive.ownershipVersion,
      status: 'ACTIVE',
    });
    expect(s.files.findOne).toHaveBeenCalledWith({
      archiveId: s.archive.id,
      id: s.file.id,
    });
    expect(s.entries.findOne).toHaveBeenCalledWith({
      archiveId: s.archive.id,
      'fileBindings.fileId': s.file.id,
      'referencePlan.protocol': 'REFERENCE_PLAN_V1',
      'referencePlan.definitionHash': s.archive.definitionHash,
      'referencePlan.bindings.fileId': s.file.id,
      $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
    });
    expect(s.registrations.find).toHaveBeenCalledWith({
      $or: [
        { id: s.registration.id },
        { key: s.registration.key },
        { archiveId: s.archive.id, fileId: s.file.id },
      ],
    });
    expect(s.registrations.create).toHaveBeenCalledWith([s.registration], {
      session,
    });
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(s.commit).toHaveBeenCalledTimes(1);
  });
  it('repeats the same evidence without inserting again, while still validating current reservation', async () => {
    const s = setup();
    await s.register();
    await expect(s.register()).resolves.toEqual(s.registration);
    expect(s.registrations.create).toHaveBeenCalledTimes(1);
    expect(s.controls.updateOne).toHaveBeenCalledTimes(2);
    s.state.control = false;
    await expect(s.register()).rejects.toThrow('drained transfer reservation');
    expect(s.registrations.create).toHaveBeenCalledTimes(1);
  });
  it('reconciles a lost commit response using the immutable record, not a second registration', async () => {
    const s = setup();
    s.state.loseReply = true;
    await expect(s.register()).rejects.toThrow('commit reply lost');
    expect(s.state.rows).toEqual([s.registration]);
    await expect(s.register()).resolves.toEqual(s.registration);
    expect(s.registrations.create).toHaveBeenCalledTimes(1);
    expect(
      s.sessions.every((session) => session.endSession.mock.calls.length === 1),
    ).toBe(true);
  });
  it('concurrent calls converge on the same identity after a simulated stale-snapshot retry', async () => {
    const s = setup();
    const [first, second] = await Promise.all([s.register(), s.register()]);
    expect(first).toEqual(second);
    expect(s.state.rows).toEqual([s.registration]);
    expect(s.registrations.find.mock.calls.length).toBeGreaterThan(2);
    expect(s.commit).toHaveBeenCalledTimes(2);
  });
  it('does not commit a stale registration after a competing control/ownership transition', async () => {
    const s = setup();
    s.state.beforeCreate = () => {
      s.state.control = false;
      s.state.epoch++;
      s.state.beforeCreate = undefined;
    };
    await expect(s.register()).rejects.toThrow('drained transfer reservation');
    expect(s.state.rows).toEqual([]);
    expect(s.commit).not.toHaveBeenCalled();
  });
  it.each([
    'archive',
    'file',
    'period',
    'control',
    'plan',
    'plan entry',
    'pending',
    'lease',
    'not materialized',
  ])('denies %s before persisting evidence', async (problem) => {
    const s = setup();
    if (problem === 'archive') s.state.archive = false;
    if (problem === 'file') s.state.file = false;
    if (problem === 'period') s.state.active = false;
    if (problem === 'control') s.state.control = false;
    if (problem === 'plan') s.state.plan = false;
    if (problem === 'plan entry') s.entry.referencePlan!.entryId = 'different';
    if (problem === 'pending') s.file.materialization!.state = 'PENDING';
    if (problem === 'lease') s.file.materialization!.leaseUntil = '2020-01-01';
    if (problem === 'not materialized')
      s.archive.materialization!.phase = 'MATERIALIZING';
    await expect(s.register()).rejects.toThrow();
    expect(s.state.rows).toEqual([]);
    expect(s.registrations.create).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.sessions[0].endSession).toHaveBeenCalledTimes(1);
  });
  it.each([
    'foreign key',
    'changed revision',
    'corrupt evidence',
    'duplicate identities',
  ])('does not replace or adopt %s', async (problem) => {
    const s = setup();
    const previous = clone(s.registration);
    if (problem === 'foreign key') previous.archiveId = 'another archive';
    if (problem === 'changed revision')
      s.file.materialization!.verified!.etag = 'changed';
    if (problem === 'corrupt evidence') previous.revision.etag = 'changed';
    s.state.rows =
      problem === 'duplicate identities'
        ? [previous, clone(previous)]
        : [previous];
    const before = clone(s.state.rows);
    await expect(s.register()).rejects.toThrow();
    expect(s.state.rows).toEqual(before);
    expect(s.registrations.create).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
  });
  it('propagates create/unique-index failures without a replacement, cleanup or partial commit', async () => {
    const s = setup();
    const error = Object.assign(new Error('unique identity collision'), {
      code: 11000,
    });
    s.state.createError = error;
    await expect(s.register()).rejects.toBe(error);
    expect(s.state.rows).toEqual([]);
    expect(s.commit).not.toHaveBeenCalled();
  });
  it('exports only an internal registrar, with a separate collection and unique identities but no TTL or defaults', () => {
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain(OwnershipArchiveMediaRegistrar);
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata('providers', OwnershipArchiveModule) as unknown[],
    ).toContainEqual({
      provide: 'OwnershipArchiveMediaRegistrationRepository',
      useClass: MongoOwnershipArchiveMediaRegistration,
    });
    expect(OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL).not.toBe(
      'AnimalMediaUpload',
    );
    expect(OwnershipArchiveMediaRegistrationSchema.get('collection')).toBe(
      'animal_transferred_media',
    );
    expect(
      OwnershipArchiveMediaRegistrationSchema.path('state').options.enum,
    ).toEqual(['PREPARED']);
    expect(
      OwnershipArchiveMediaRegistrationSchema.path('state').options.default,
    ).toBeUndefined();
    const indexes = OwnershipArchiveMediaRegistrationSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ unique: true }),
        ],
        [
          expect.objectContaining({ key: 1 }),
          expect.objectContaining({ unique: true }),
        ],
        [
          expect.objectContaining({ archiveId: 1, fileId: 1 }),
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
    expect(
      indexes.every(([, options]) => options.expireAfterSeconds === undefined),
    ).toBe(true);
  });
});
