import { Schema } from 'mongoose';
import { MongoTransferAcceptanceStart } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-start';
import { TransferAcceptanceStart } from '../../../src/context/animal-transfer/application/transfer-acceptance-start';
import {
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
  TransferEventSchema,
  TransferNoticeSchema,
  TransferOutboxSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { AnimalSchema } from '../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { UserSchema } from '../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import {
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MedicalDocumentSchema } from '../../../src/context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { DiaryEntrySchema } from '../../../src/context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import { AnimalMediaUploadSchema } from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  OwnershipArchiveSchema,
  OwnershipArchiveFileSchema,
  OwnershipArchiveEntrySchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  acceptanceAt,
  acceptanceFixture,
} from './transfer-acceptance-preparation.fixture';
import { archiveAnimal } from './ownership-archive.fixture';
import { ItemCopyRecordSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import { OwnershipArchiveMediaRegistrationSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';

export type AcceptanceTestRow = Record<string, unknown>;
type Role =
  | 'requests'
  | 'items'
  | 'claims'
  | 'animals'
  | 'controls'
  | 'periods'
  | 'medical'
  | 'diary'
  | 'media'
  | 'archives'
  | 'events'
  | 'users'
  | 'files'
  | 'entries'
  | 'copyRecords'
  | 'registrations'
  | 'notices'
  | 'outbox';
type Db = Record<Role, AcceptanceTestRow[]>;
type Session = {
  current: Db;
  epoch: number;
  client: object;
  transaction: { options?: unknown };
  inTransaction: () => boolean;
  abortTransaction: jest.Mock;
  endSession: jest.Mock;
  withTransaction: jest.Mock;
};
type Options = { session?: Session };
export type AcceptanceTestCall = {
  role: Role;
  method: string;
  filter: AcceptanceTestRow;
  update?: AcceptanceTestRow;
  session?: Session;
  projection?: Record<string, number>;
  limit?: number;
  options?: Record<string, unknown>;
  sort?: Record<string, number>;
  collation?: Record<string, string>;
};
const clone = <T>(value: T): T => structuredClone(value);
function valueAt(row: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (Array.isArray(value)) {
      if (/^(0|[1-9]\d*)$/.test(part))
        return (value as unknown[])[Number(part)];
      const values: unknown[] = value.flatMap((entry: unknown) => {
        const field =
          entry && typeof entry === 'object'
            ? (entry as AcceptanceTestRow)[part]
            : undefined;
        return field === undefined ? [] : [field];
      });
      return values.length ? values : undefined;
    }
    return value && typeof value === 'object'
      ? (value as AcceptanceTestRow)[part]
      : undefined;
  }, row);
}
function matches(row: AcceptanceTestRow, filter: AcceptanceTestRow): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or')
      return (expected as AcceptanceTestRow[]).some((f) => matches(row, f));
    if (key === '$and')
      return (expected as AcceptanceTestRow[]).every((f) => matches(row, f));
    if (key === '$expr') {
      const e = expected as AcceptanceTestRow;
      if (e.$lte)
        return (
          (typeof row.uploadsValidUntil === 'string'
            ? row.uploadsValidUntil
            : '') <= acceptanceAt
        );
      if (e.$eq) return ((row.activeWrites ?? []) as unknown[]).length === 0;
      throw new Error('Unsupported acceptance-test expression');
    }
    const actual = valueAt(row, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected))
      return Object.entries(expected).every(([op, operand]) => {
        if (op === '$exists') return (actual !== undefined) === operand;
        if (op === '$in') return (operand as unknown[]).includes(actual);
        if (op === '$nin') return !(operand as unknown[]).includes(actual);
        if (op === '$ne') return actual !== operand;
        if (op === '$lte')
          return typeof actual === 'string' && actual <= (operand as string);
        if (op === '$gt')
          return typeof actual === 'string' && actual > (operand as string);
        if (op === '$type') return operand === 'null' && actual === null;
        throw new Error(`Unsupported acceptance-test filter ${op}`);
      });
    if (Array.isArray(expected))
      return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        expected.every((value, index) => value === actual[index])
      );
    return Array.isArray(actual)
      ? actual.includes(expected)
      : actual === expected;
  });
}
function updateRow(row: AcceptanceTestRow, update: AcceptanceTestRow) {
  for (const [key, value] of Object.entries(
    (update.$set ?? {}) as AcceptanceTestRow,
  )) {
    const separator = key.lastIndexOf('.');
    const parent = separator < 0 ? row : valueAt(row, key.slice(0, separator));
    if (!parent || typeof parent !== 'object' || Array.isArray(parent))
      throw new Error('Unsupported acceptance-test update path');
    (parent as AcceptanceTestRow)[key.slice(separator + 1)] = clone(value);
  }
  for (const [key, value] of Object.entries(
    (update.$inc ?? {}) as AcceptanceTestRow,
  ))
    row[key] = Number(row[key] ?? 0) + Number(value);
  for (const key of Object.keys((update.$unset ?? {}) as AcceptanceTestRow))
    delete row[key];
}

/** Optimistic snapshot/rollback double. Not a Mongo concurrency or majority proof. */
export function acceptanceStartStore(count: 1 | 3 = 3) {
  const f = acceptanceFixture(count);
  const animalNumbers = count === 1 ? [100] : [100, 101];
  const input = {
    ...f.input,
    acceptedAnimalIds: [...animalNumbers].reverse().map((n) => f.id(n)),
  };
  const db: Db = {
    requests: [clone(f.snapshot.request!)],
    items: clone(f.snapshot.items),
    claims: clone(f.snapshot.claims),
    animals: animalNumbers.map((n) => ({
      ...clone(archiveAnimal),
      id: f.id(n),
      ownerId: f.actorId,
      isActive: true,
    })),
    controls: animalNumbers.map((n) => ({
      animalId: f.id(n),
      ownerId: f.actorId,
      ownershipVersion: 1,
      activeWrites: [],
    })),
    periods: animalNumbers.map((n) => ({
      id: f.id(n + 100),
      animalId: f.id(n),
      ownerId: f.actorId,
      ownershipVersion: 1,
      status: 'ACTIVE',
    })),
    medical: [],
    diary: [],
    media: [],
    archives: [],
    events: [],
    users: [{ id: f.recipientId }],
    files: [],
    entries: [],
    copyRecords: [],
    registrations: [],
    notices: [],
    outbox: [],
  };
  const state = {
    db,
    epoch: 0,
    failAtWrite: 0,
    writes: 0,
    noOp: '',
    missingCollection: '',
    badIndex: '',
    loseReply: false,
    endFailure: false,
    manifestBatchSize: 0,
    beforeCommit: undefined as (() => void) | undefined,
  };
  const calls: AcceptanceTestCall[] = [],
    sessions: Session[] = [];
  const client = {};
  const connection = {
    readyState: 1,
    getClient: () => client,
    startSession: jest.fn(() => {
      let active = false;
      const session: Session = {
        current: clone(state.db),
        epoch: state.epoch,
        client,
        transaction: {},
        inTransaction: () => active,
        abortTransaction: jest.fn(() => {
          active = false;
          return Promise.resolve();
        }),
        endSession: jest.fn(() =>
          state.endFailure
            ? Promise.reject(new Error('private close error'))
            : Promise.resolve(),
        ),
        withTransaction: jest.fn(
          async (work: () => Promise<unknown>, options: unknown) => {
            session.transaction = { options };
            active = true;
            let result: unknown;
            try {
              result = await work();
              if (!active) return result;
            } finally {
              active = false;
            }
            state.beforeCommit?.();
            if (session.epoch !== state.epoch)
              throw new Error('simulated transaction write conflict');
            state.db = clone(session.current);
            state.epoch++;
            if (state.loseReply) {
              state.loseReply = false;
              throw new Error(
                'simulated lost application response after commit',
              );
            }
            return result;
          },
        ),
      };
      sessions.push(session);
      return Promise.resolve(session);
    }),
    db: {
      admin: () => ({
        command: () =>
          Promise.resolve({
            setName: 'synthetic',
            isWritablePrimary: true,
            logicalSessionTimeoutMinutes: 30,
          }),
      }),
      listCollections: () => ({
        toArray: () =>
          Promise.resolve(
            schemas
              .filter(
                ([, schema]) =>
                  schema.get('collection') !== state.missingCollection,
              )
              .map(([, schema]) => ({
                name: schema.get('collection') as string,
                type: 'collection',
                options: {},
              })),
          ),
      }),
      collection: (name: string) => ({
        listIndexes: () => ({
          toArray: () =>
            Promise.resolve(
              name === state.badIndex
                ? []
                : schemas
                    .find(([, schema]) => schema.get('collection') === name)![1]
                    .indexes()
                    .map(([key, options]) => ({ key, ...options })),
            ),
        }),
      }),
    },
  };
  const schemas: Array<[Role, Schema]> = [
    ['requests', TransferRequestSchema],
    ['items', TransferRequestItemSchema],
    ['claims', TransferRequestClaimSchema],
    ['animals', AnimalSchema],
    ['controls', AnimalOwnershipControlSchema],
    ['periods', AnimalOwnershipPeriodSchema],
    ['medical', MedicalDocumentSchema],
    ['diary', DiaryEntrySchema],
    ['media', AnimalMediaUploadSchema],
    ['archives', OwnershipArchiveSchema],
    ['events', TransferEventSchema],
    ['users', UserSchema],
    ['files', OwnershipArchiveFileSchema],
    ['entries', OwnershipArchiveEntrySchema],
    ['copyRecords', ItemCopyRecordSchema],
    ['registrations', OwnershipArchiveMediaRegistrationSchema],
    ['notices', TransferNoticeSchema],
    ['outbox', TransferOutboxSchema],
  ];
  function model(role: Role) {
    function query(
      method: string,
      filter: AcceptanceTestRow,
      update?: AcceptanceTestRow,
      options?: Options,
    ) {
      const call: AcceptanceTestCall = {
        role,
        method,
        filter,
        update,
        session: options?.session,
      };
      const q = {
        select: (p: Record<string, number>) => {
          call.projection = p;
          return q;
        },
        session: (s: Session) => {
          call.session = s;
          return q;
        },
        lean: () => q,
        maxTimeMS: () => q,
        setOptions: (options: Record<string, unknown>) => {
          call.options = options;
          return q;
        },
        collation: (collation: Record<string, string>) => {
          call.collation = collation;
          return q;
        },
        sort: (sort: Record<string, number>) => {
          call.sort = sort;
          return q;
        },
        limit: (limit: number) => {
          call.limit = limit;
          return q;
        },
        exec: () => {
          calls.push(call);
          if (!call.session)
            throw new Error(
              'Acceptance-test business operation missing session',
            );
          const rows = call.session.current[role];
          let found = rows.filter((r) => matches(r, filter));
          if (call.limit)
            found = found
              .sort((a, b) =>
                String(a.animalId ?? a.id).localeCompare(
                  String(b.animalId ?? b.id),
                ),
              )
              .slice(0, call.limit);
          if (
            method === 'find' &&
            (role === 'entries' || role === 'files') &&
            state.manifestBatchSize > 0
          )
            found = found.slice(0, state.manifestBatchSize);
          const write = [
            'updateOne',
            'updateMany',
            'deleteMany',
            'deleteOne',
            'findOneAndUpdate',
            'create',
            'insertMany',
          ].includes(method);
          if (write && ++state.writes === state.failAtWrite)
            throw new Error('private synthetic write failure');
          if (write && state.noOp === `${role}.${method}`)
            return Promise.resolve({
              matchedCount: found.length,
              modifiedCount: 0,
              deletedCount: 0,
            });
          let result: unknown;
          if (method === 'create' || method === 'insertMany') {
            rows.push(...clone(update!.rows as AcceptanceTestRow[]));
            result = update!.rows;
          } else if (method === 'deleteMany' || method === 'deleteOne') {
            const deleted = new Set(
              method === 'deleteOne' ? found.slice(0, 1) : found,
            );
            call.session.current[role] = rows.filter(
              (row) => !deleted.has(row),
            );
            result = { deletedCount: deleted.size };
          } else if (
            method === 'updateOne' ||
            method === 'updateMany' ||
            method === 'findOneAndUpdate'
          ) {
            const targets = method === 'updateMany' ? found : found.slice(0, 1);
            for (const row of targets) updateRow(row, update!);
            result =
              method === 'findOneAndUpdate'
                ? (targets[0] ?? null)
                : {
                    matchedCount: targets.length,
                    modifiedCount: targets.length,
                  };
          } else if (method === 'countDocuments') result = found.length;
          else result = method === 'find' ? found : (found[0] ?? null);
          if (
            call.projection &&
            result &&
            ['find', 'findOne', 'findById', 'findOneAndUpdate'].includes(method)
          ) {
            const project = (row: AcceptanceTestRow) =>
              Object.fromEntries(
                Object.entries(row).filter(([key]) =>
                  Object.values(call.projection!).includes(1)
                    ? call.projection![key] === 1
                    : call.projection![key] !== 0,
                ),
              );
            result = Array.isArray(result)
              ? result.map((r: AcceptanceTestRow) => project(r))
              : project(result as AcceptanceTestRow);
          }
          // Lean archive rows return plain documents in the caller's realm.
          if (
            ['copyRecords', 'files', 'registrations'].includes(role) &&
            ['find', 'findOne'].includes(method)
          )
            return Promise.resolve(JSON.parse(JSON.stringify(result)));
          return Promise.resolve(clone(result));
        },
      };
      return q;
    }
    return {
      db: connection,
      findById: (id: string) => query('findById', { _id: id }),
      find: (filter: AcceptanceTestRow) => query('find', filter),
      findOne: (filter: AcceptanceTestRow) => query('findOne', filter),
      exists: (filter: AcceptanceTestRow) => query('exists', filter),
      countDocuments: (filter: AcceptanceTestRow) =>
        query('countDocuments', filter),
      updateOne: (f: AcceptanceTestRow, u: AcceptanceTestRow, o: Options) =>
        query('updateOne', f, u, o),
      updateMany: (f: AcceptanceTestRow, u: AcceptanceTestRow, o: Options) =>
        query('updateMany', f, u, o),
      deleteMany: (f: AcceptanceTestRow, o: Options) =>
        query('deleteMany', f, undefined, o),
      deleteOne: (f: AcceptanceTestRow, o: Options) =>
        query('deleteOne', f, undefined, o),
      findOneAndUpdate: (
        f: AcceptanceTestRow,
        u: AcceptanceTestRow,
        o: Options,
      ) => query('findOneAndUpdate', f, u, o),
      create: (rows: AcceptanceTestRow[], o: Options) =>
        query('create', {}, { rows }, o).exec(),
      insertMany: (rows: AcceptanceTestRow[], o: Options) =>
        query('insertMany', {}, { rows }, o).exec(),
      bulkWrite: async (
        writes: {
          updateOne: { filter: AcceptanceTestRow; update: AcceptanceTestRow };
        }[],
        options: Options,
      ) => {
        let matchedCount = 0;
        let modifiedCount = 0;
        for (const { updateOne } of writes) {
          const result = (await query(
            'updateOne',
            updateOne.filter,
            updateOne.update,
            options,
          ).exec()) as { matchedCount: number; modifiedCount: number };
          matchedCount += result.matchedCount;
          modifiedCount += result.modifiedCount;
        }
        return { matchedCount, modifiedCount };
      },
    };
  }
  const models = schemas.map(([role]) => model(role));
  const keys = {
    keyFromUrl: jest.fn((url: string) =>
      url.startsWith('https://synthetic.invalid/')
        ? url.slice('https://synthetic.invalid/'.length)
        : undefined,
    ),
  };
  const store = new MongoTransferAcceptanceStart(
    ...([...models.slice(0, 12), keys] as unknown as ConstructorParameters<
      typeof MongoTransferAcceptanceStart
    >),
  );
  return {
    ...f,
    input,
    state,
    calls,
    models,
    schemas,
    sessions,
    connection,
    keys,
    store,
    service: new TransferAcceptanceStart(store),
  };
}
