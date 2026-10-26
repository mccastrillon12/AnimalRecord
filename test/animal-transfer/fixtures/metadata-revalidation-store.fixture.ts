import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ArchiveMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { ArchiveMetadataRevalidation } from '../../../src/context/animal-transfer/domain/ownership-archive-metadata-revalidation';
import { MongoOwnershipArchiveMetadataRevalidation } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-metadata-revalidation';
import { AnimalOwnershipControlEntity } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { metadataRevalidationFixture } from './ownership-archive-metadata-revalidation.fixture';
import {
  historyClone as clone,
  historyKeyFromUrl,
} from './ownership-archive-history.fixture';

type Row = Record<string, unknown>;
type Db = {
  runs: ArchiveMetadataRevalidation[];
  archives: OwnershipArchive[];
  entries: ArchiveEntry[];
  files: ArchiveFile[];
  registrations: ArchiveMediaRegistration[];
  controls: AnimalOwnershipControlEntity[];
  periods: Row[];
};
type Session = {
  current: { db: Db; epoch: number };
  withTransaction: jest.Mock;
  endSession: jest.Mock;
};
function values(value: unknown, path: string[]): unknown[] {
  if (!path.length) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => values(item, path));
  return values((value as Row | undefined)?.[path[0]], path.slice(1));
}
function expression(value: unknown, row: Row): unknown {
  if (typeof value === 'string' && value.startsWith('$'))
    return values(row, value.slice(1).split('.'))[0];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const op = value as Row;
    if ('$ifNull' in op) {
      const [first, fallback] = op.$ifNull as unknown[];
      return expression(first, row) ?? fallback;
    }
    if ('$size' in op) return (expression(op.$size, row) as unknown[]).length;
  }
  return value;
}
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$expr') {
      const [a, b] = (expected as { $eq: unknown[] }).$eq;
      return expression(a, row) === expression(b, row);
    }
    const actual = values(row, key.split('.'));
    if (expected && typeof expected === 'object')
      return Object.entries(expected as Row).every(([op, operand]) => {
        if (op === '$gt')
          return actual.some(
            (v) => typeof v === 'string' && v > (operand as string),
          );
        if (op === '$exists')
          return actual.some((v) => v !== undefined) === operand;
        throw new Error(`Unsupported metadata test filter ${op}`);
      });
    return actual.some((v) => v === expected);
  });
}

/** Optimistic snapshot/rollback double, NOT Mongo integration or a production recovery protocol. */
export function metadataStore(
  medicalCount = 2,
  profileFile = true,
  retained = false,
) {
  const fixture = metadataRevalidationFixture(
    medicalCount,
    profileFile,
    retained,
  );
  const state = {
    epoch: 0,
    db: clone({
      runs: [],
      archives: [fixture.archive],
      entries: fixture.entries,
      files: fixture.files,
      registrations: fixture.registrations,
      controls: [fixture.control],
      periods: [
        {
          id: fixture.archive.periodId,
          animalId: fixture.archive.animalId,
          ownerId: fixture.archive.ownerId,
          ownershipVersion: fixture.archive.ownershipVersion,
          status: 'ACTIVE',
        },
      ],
    }) as Db,
    loseReply: false,
    failSave: false,
    beforeSave: undefined as (() => void) | undefined,
  };
  const commit = jest.fn();
  const sessions: Session[] = [];
  const startSession = jest.fn(() => {
    const session: Session = {
      current: { db: clone(state.db), epoch: state.epoch },
      endSession: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(async (work: () => Promise<unknown>) => {
        for (let attempt = 0; attempt < 8; attempt++) {
          session.current = { db: clone(state.db), epoch: state.epoch };
          const result = await work();
          if (session.current.epoch !== state.epoch) continue;
          state.db = session.current.db;
          state.epoch++;
          commit();
          if (state.loseReply) {
            state.loseReply = false;
            throw new Error('metadata commit reply lost');
          }
          return result;
        }
        throw new Error('metadata snapshot retries exhausted');
      }),
    };
    sessions.push(session);
    return Promise.resolve(session);
  });
  function query(read: (db: Db) => unknown) {
    let session: Session | undefined;
    let limit = Infinity;
    let sort = false;
    const q = {
      session: jest.fn(),
      select: jest.fn(),
      sort: jest.fn(),
      limit: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(() => {
        let result = read(session?.current.db ?? state.db);
        if (Array.isArray(result)) {
          result = [...(result as unknown[])];
          if (sort)
            (result as Array<{ id: string }>).sort((a, b) =>
              a.id.localeCompare(b.id),
            );
          result = (result as unknown[]).slice(0, limit);
        }
        return Promise.resolve(clone(result));
      }),
    };
    q.session.mockImplementation((value: Session) => {
      session = value;
      return q;
    });
    q.select.mockReturnValue(q);
    q.lean.mockReturnValue(q);
    q.sort.mockImplementation(() => {
      sort = true;
      return q;
    });
    q.limit.mockImplementation((value: number) => {
      limit = value;
      return q;
    });
    return q;
  }
  function model(table: keyof Db) {
    return {
      db: { startSession },
      findOne: jest.fn((filter: Row) =>
        query(
          (db) =>
            (db[table] as unknown as Row[]).find((row) =>
              matches(row, filter),
            ) ?? null,
        ),
      ),
      find: jest.fn((filter: Row) =>
        query((db) =>
          (db[table] as unknown as Row[]).filter((row) => matches(row, filter)),
        ),
      ),
      exists: jest.fn((filter: Row) =>
        query((db) =>
          (db[table] as unknown as Row[]).some((row) => matches(row, filter))
            ? { _id: 'exists' }
            : null,
        ),
      ),
      countDocuments: jest.fn((filter: Row) =>
        query(
          (db) =>
            (db[table] as unknown as Row[]).filter((row) =>
              matches(row, filter),
            ).length,
        ),
      ),
      create: jest.fn((rows: Row[], options: { session: Session }) => {
        (options.session.current.db[table] as unknown as Row[]).push(
          ...clone(rows),
        );
        return Promise.resolve(clone(rows));
      }),
      updateOne: jest.fn(
        (
          filter: Row,
          update: { $set?: Row; $inc?: Record<string, number> },
          options: { session: Session },
        ) => {
          const q = query((db) => {
            if (table === 'runs') {
              state.beforeSave?.();
              if (state.failSave) return { modifiedCount: 0 };
            }
            const row = (db[table] as unknown as Row[]).find((row) =>
              matches(row, filter),
            );
            if (!row) return { modifiedCount: 0 };
            Object.assign(row, clone(update.$set ?? {}));
            for (const [field, increment] of Object.entries(update.$inc ?? {}))
              row[field] =
                ((row[field] as number | undefined) ?? 0) + increment;
            return { modifiedCount: 1 };
          });
          q.session(options.session);
          return q;
        },
      ),
    };
  }
  const runs = model('runs'),
    archives = model('archives'),
    entries = model('entries'),
    files = model('files'),
    registrations = model('registrations'),
    controls = model('controls'),
    periods = model('periods');
  const storage = { keyFromUrl: jest.fn(historyKeyFromUrl) };
  const repository = new MongoOwnershipArchiveMetadataRevalidation(
    runs as never,
    archives as never,
    entries as never,
    files as never,
    registrations as never,
    controls as never,
    periods as never,
    storage,
  );
  return {
    fixture,
    state,
    commit,
    sessions,
    repository,
    runs,
    archives,
    entries,
    files,
    registrations,
    controls,
    periods,
    storage,
  };
}
