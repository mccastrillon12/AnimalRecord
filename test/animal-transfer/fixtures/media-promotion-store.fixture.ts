import { Model } from 'mongoose';
import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';
import { MongoAnimalWriteJournal } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { MongoMediaPromotionPersistence } from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-persistence';
import { PromotionStoredCommand } from '../../../src/context/animal-media/domain/media-promotion-persistence';
import { promotionFixture } from './media-promotion.fixture';

export type PromotionTestRow = Record<string, unknown>;
type Kind = 'records' | 'journals' | 'controls' | 'uploads';
type Store = Record<Kind, PromotionTestRow[]>;
const clone = <T>(v: T): T => structuredClone(v);
function path(row: PromotionTestRow, key: string): unknown {
  return key
    .split('.')
    .reduce((r: unknown, k) => (r as PromotionTestRow | undefined)?.[k], row);
}
function match(row: PromotionTestRow, filter: PromotionTestRow): boolean {
  return Object.entries(filter).every(([key, expected]: [string, unknown]) => {
    const actual = path(row, key);
    if (expected && typeof expected === 'object')
      return Object.entries(expected).every(([op, v]: [string, unknown]) => {
        if (op === '$exists') return (actual !== undefined) === v;
        if (op === '$elemMatch')
          return (
            Array.isArray(actual) &&
            actual.some((r: PromotionTestRow) =>
              match(r, v as PromotionTestRow),
            )
          );
        if (op === '$in') return (v as unknown[]).includes(actual);
        throw new Error(`Unsupported promotion fixture operator ${op}`);
      });
    return actual === expected;
  });
}
function set(row: PromotionTestRow, key: string, value: unknown) {
  const parts = key.split('.');
  let target = row;
  for (const p of parts.slice(0, -1)) target = target[p] as PromotionTestRow;
  target[parts[parts.length - 1]] = clone(value);
}
function unique(rows: PromotionTestRow[]) {
  const ids = new Set<string>(),
    identities = new Set<string>(),
    resources = new Set<string>(),
    ordinals = new Set<string>();
  for (const r of rows) {
    const keys =
      r.kind === 'EFFECT'
        ? [
            `upload:${String(r.operationId)}:${String(r.uploadId)}`,
            `destination:${String(r.operationId)}:${String(r.bucket)}:${String(r.destinationKey)}`,
          ]
        : [];
    const ordinal = `${String(r.effectId)}:${String(r.ordinal)}`;
    if (
      ids.has(r.id as string) ||
      (r.identityIds as string[]).some((i) => identities.has(i)) ||
      keys.some((k) => resources.has(k)) ||
      (r.kind === 'ATTEMPT' && ordinals.has(ordinal))
    )
      throw Object.assign(new Error('Duplicate simulated index'), {
        code: 11000,
      });
    ids.add(r.id as string);
    for (const i of r.identityIds as string[]) identities.add(i);
    keys.forEach((k) => resources.add(k));
    if (r.kind === 'ATTEMPT') ordinals.add(ordinal);
  }
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Coarse optimistic snapshots with callback retry/rollback. Never connects to Mongo. */
export function promotionStoreFixture(
  kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
) {
  const s = promotionFixture(kind);
  s.journal.mediaPromotionProtocol = 'MEDIA_PROMOTION_ROWS_V1';
  const selection = {
    operationId: s.journal.id,
    instanceId: s.journal.instanceId,
    animalId: s.animalId,
  };
  const audit = {
    requestId: s.id(12),
    operatorId: s.id(13),
    evidenceRef: 'incident:31',
  };
  const declare: PromotionStoredCommand = {
    type: 'DECLARE_EFFECT',
    effectId: s.effectId,
    uploadId: s.upload.id,
    bucket: 'animalrecord-test-media',
  };
  const authorize = { ...s.authorize, dispatcherInstanceId: s.id(10) };
  let state: Store = {
    records: [],
    journals: [clone(s.journal)],
    uploads: [clone(s.upload)],
    controls: [
      {
        animalId: s.animalId,
        ownerId: s.journal.actorId,
        ownershipVersion: 2,
        activeWrites: [
          {
            token: s.journal.id,
            operationId: s.journal.id,
            instanceId: s.journal.instanceId,
            startedAt: s.journal.createdAt,
          },
        ],
      },
    ],
  };
  let revision = 0,
    retries = 0,
    lostReply = false;
  let hook:
    | { kind: Kind; method: string; run: () => Promise<void> }
    | undefined;
  let failure:
    | { kind: Kind; method: string; zero?: boolean; skip: number }
    | undefined;
  const log: Array<{
    kind: Kind;
    method: string;
    session: boolean;
    filter?: unknown;
    update?: unknown;
  }> = [];
  const options: unknown[] = [];
  class Session {
    snapshot!: Store;
    async withTransaction<T>(
      work: () => Promise<T>,
      opts: unknown,
    ): Promise<T> {
      options.push(opts);
      for (let i = 0; i < 6; i++) {
        const observed = revision;
        this.snapshot = clone(state);
        const result = await work();
        if (observed !== revision) {
          retries++;
          continue;
        }
        unique(this.snapshot.records);
        state = this.snapshot;
        revision++;
        if (lostReply) {
          lostReply = false;
          throw new Error('Simulated application reply lost after commit');
        }
        return result;
      }
      throw new Error('Simulated transaction retry limit');
    }
    endSession() {
      return Promise.resolve();
    }
  }
  const db = { startSession: () => Promise.resolve(new Session()) };
  async function before(kind: Kind, method: string) {
    if (hook?.kind === kind && hook.method === method) {
      const h = hook;
      hook = undefined;
      await h.run();
    }
    if (failure?.kind === kind && failure.method === method) {
      if (failure.skip > 0) {
        failure.skip--;
        return true;
      }
      const f = failure;
      failure = undefined;
      if (f.zero) return false;
      throw new Error('Injected promotion persistence failure');
    }
    return true;
  }
  const model = (kind: Kind) => ({
    db,
    findOne: (filter: PromotionTestRow) => {
      let session: Session | undefined;
      const q = {
        session: (v: Session) => {
          session = v;
          return q;
        },
        read: () => q,
        readConcern: () => q,
        maxTimeMS: () => q,
        lean: () => q,
        select: () => q,
        exec: async () => {
          log.push({ kind, method: 'findOne', session: !!session, filter });
          await before(kind, 'findOne');
          return clone(
            (session?.snapshot ?? state)[kind].find((r) => match(r, filter)) ??
              null,
          );
        },
      };
      return q;
    },
    create: async (rows: PromotionTestRow[], opts: { session: Session }) => {
      log.push({ kind, method: 'create', session: !!opts.session });
      await before(kind, 'create');
      opts.session.snapshot[kind].push(...clone(rows));
      if (kind === 'records') unique(opts.session.snapshot.records);
      return rows;
    },
    updateOne: (
      filter: PromotionTestRow,
      update: PromotionTestRow,
      opts: { session?: Session },
    ) => ({
      exec: async () => {
        log.push({
          kind,
          method: 'updateOne',
          session: !!opts.session,
          filter,
          update,
        });
        if (!(await before(kind, 'updateOne'))) return { matchedCount: 0 };
        const rows = (opts.session?.snapshot ?? state)[kind],
          row = rows.find((r) => match(r, filter));
        if (!row) return { matchedCount: 0 };
        for (const [op, fields] of Object.entries(update) as Array<
          [string, PromotionTestRow]
        >)
          for (const [key, value] of Object.entries(fields)) {
            if (op === '$set') set(row, key, value);
            else if (op === '$inc')
              set(
                row,
                key,
                ((path(row, key) as number | undefined) ?? 0) +
                  (value as number),
              );
            else throw new Error(`Unsupported promotion fixture update ${op}`);
          }
        if (kind === 'records') unique(rows);
        if (!opts.session) revision++;
        return { matchedCount: 1 };
      },
    }),
  });
  const models = {
    records: model('records'),
    journals: model('journals'),
    controls: model('controls'),
    uploads: model('uploads'),
  };
  const instance = () =>
    new MongoMediaPromotionPersistence(
      models.records as never,
      models.journals as never,
      models.controls as never,
      models.uploads as never,
    );
  const repository = instance();
  return {
    ...s,
    selection,
    audit,
    declare,
    authorize,
    repository,
    instance,
    models,
    log,
    options,
    journal: new MongoAnimalWriteJournal(
      models.journals as unknown as Model<AnimalWriteJournal>,
    ),
    state: () => clone(state),
    change: (kind: Kind, mutate: (rows: PromotionTestRow[]) => void) => {
      mutate(state[kind]);
      revision++;
    },
    retries: () => retries,
    loseReply: () => {
      lostReply = true;
    },
    fail: (kind: Kind, method: string, zero = false, skip = 0) => {
      failure = { kind, method, zero, skip };
    },
    pause: (kind: Kind, method = 'updateOne') => {
      const entered = signal(),
        resume = signal();
      hook = {
        kind,
        method,
        run: async () => {
          entered.resolve();
          await resume.promise;
        },
      };
      return { entered: entered.promise, resume: resume.resolve };
    },
    prepare: async () => {
      let g = await repository.open(selection);
      g = await repository.apply(selection, g.gateRevision, declare);
      return repository.apply(selection, g.gateRevision, s.intention);
    },
  };
}
