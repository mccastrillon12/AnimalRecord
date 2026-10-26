import { Model } from 'mongoose';
import {
  AnimalWriteJournal,
  AnimalWriteRecoveryRequest,
} from '../../../src/context/animal-transfer/domain/animal-write-journal';
import { AnimalOwnershipControl } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { MongoAnimalWriteJournal } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';

type Row = Record<string, unknown>;
type Store = {
  journal: AnimalWriteJournal;
  controls: AnimalOwnershipControl[];
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const input: AnimalWriteRecoveryRequest = {
  operationId: 'operation',
  instanceId: 'instance',
  requestId: 'request',
  operatorId: 'operator',
  reason: 'OPERATOR_INTERVENTION',
  evidenceRef: 'incident-42',
};
const handle = { id: input.operationId, instanceId: input.instanceId };
const claimInput = (animalId = 'a') => ({
  animalId,
  ownerId: 'owner',
  expectedOwnershipVersion: 1,
  token: input.operationId,
  startedAt: 'now',
  journal: { operationId: input.operationId, instanceId: input.instanceId },
});

// Deliberately small optimistic snapshot double: exercises the actual adapters'
// filters and updates with rollback/retry. It is not a Mongo integration test.
function values(value: unknown, path: string[]): unknown[] {
  if (!path.length) return [value];
  if (Array.isArray(value) && !/^\d+$/.test(path[0]))
    return value.flatMap((item: unknown) => values(item, path));
  return values((value as Row | undefined)?.[path[0]], path.slice(1));
}
function matches(row: unknown, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = values(row, key.split('.'));
    if (!expected || typeof expected !== 'object')
      return actual.some((value) => value === expected);
    const operators = expected as Row;
    return Object.entries(operators).every(([op, operand]) => {
      if (op === '$exists')
        return actual.some((v) => v !== undefined) === operand;
      if (op === '$ne') return actual.every((v) => v !== operand);
      if (op === '$in')
        return actual.some((v) => (operand as unknown[]).includes(v));
      if (op === '$nin')
        return actual.every((v) => !(operand as unknown[]).includes(v));
      if (op === '$elemMatch')
        return actual.some(
          (v) =>
            Array.isArray(v) &&
            v.some((item: unknown) => matches(item, operand as Row)),
        );
      if (op === '$not')
        return !matches({ field: actual[0] }, { field: operand });
      throw new Error(`Unsupported test operator ${op}`);
    });
  });
}
function apply(row: Row, update: Row, filter: Row) {
  for (const [op, payload] of Object.entries(update)) {
    for (const [path, value] of Object.entries(payload as Row)) {
      if (op === '$set') {
        const [root, position, leaf] = path.split('.');
        if (!position) row[root] = clone(value);
        else {
          const items = row[root] as Row[];
          const match = (filter[root] as Row)?.$elemMatch as Row;
          for (const item of items)
            if (position === '$[]' || matches(item, match))
              item[leaf] = clone(value);
        }
      } else if (op === '$push') (row[path] as unknown[]).push(clone(value));
      else if (op === '$pull')
        row[path] = (row[path] as unknown[]).filter(
          (item) => !matches(item, value as Row),
        );
      else throw new Error(`Unsupported test update ${op}`);
    }
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let state: Store = {
    journal: {
      ...handle,
      protocol: 'TRANSACTIONAL_CLAIMS_V1',
      actorId: 'owner',
      instanceStartedAt: 'before',
      createdAt: 'before',
      updatedAt: 'before',
      kind: 'ANIMAL_UPDATE',
      issuesUploadUrl: false,
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      claims: [
        {
          animalId: 'a',
          state: 'INTENT',
          ownershipVersion: 1,
          updatedAt: 'before',
        },
        {
          animalId: 'b',
          state: 'INTENT',
          ownershipVersion: 1,
          updatedAt: 'before',
        },
      ],
    },
    controls: ['a', 'b'].map((animalId) => ({
      animalId,
      ownerId: 'owner',
      ownershipVersion: 1,
      activeWrites: [],
    })),
  };
  let revision = 0,
    retries = 0,
    loseCommitReply = false;
  let hook: (() => Promise<void>) | undefined;
  class Session {
    snapshot!: Store;
    async withTransaction(work: () => Promise<void>) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const observed = revision;
        this.snapshot = clone(state);
        await work();
        if (observed !== revision) {
          retries++;
          continue;
        }
        state = this.snapshot;
        revision++;
        if (loseCommitReply) {
          loseCommitReply = false;
          throw new Error('Commit reply lost');
        }
        return;
      }
      throw new Error('Test retry limit');
    }
    endSession() {
      return Promise.resolve();
    }
  }
  const model = (kind: 'journal' | 'controls') => ({
    db: { startSession: () => Promise.resolve(new Session()) },
    findOne: (filter: Row) => {
      let session: Session | undefined;
      const query = {
        session: (value: Session) => {
          session = value;
          return query;
        },
        select: () => query,
        read: () => query,
        readConcern: () => query,
        lean: () => query,
        exec: () => {
          const data = session?.snapshot ?? state;
          const rows = kind === 'journal' ? [data.journal] : data.controls;
          return Promise.resolve(
            clone(rows.find((row) => matches(row, filter)) ?? null),
          );
        },
      };
      return query;
    },
    updateOne: (filter: Row, update: Row, options: { session?: Session }) => ({
      exec: async () => {
        if (kind === 'journal' && options.session && hook) {
          const current = hook;
          hook = undefined;
          await current();
        }
        const data = options.session?.snapshot ?? state;
        const rows = kind === 'journal' ? [data.journal] : data.controls;
        const row = rows.find((candidate) => matches(candidate, filter));
        if (!row) return { matchedCount: 0, modifiedCount: 0 };
        apply(row as unknown as Row, update, filter);
        if (!options.session) revision++;
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  });
  const controls = model('controls'),
    journals = model('journal');
  const ownership = new MongoAnimalOwnershipRepository(
    {} as never,
    controls as never,
    {} as never,
    journals as never,
  );
  const journal = new MongoAnimalWriteJournal(
    journals as unknown as Model<AnimalWriteJournal>,
  );
  return {
    ownership,
    journal,
    state: () => state,
    retries: () => retries,
    loseCommitReply: () => {
      loseCommitReply = true;
    },
    pauseJournalWrite: () => {
      const entered = deferred(),
        resume = deferred();
      hook = async () => {
        entered.resolve();
        await resume.promise;
      };
      return { entered: entered.promise, resume: resume.resolve };
    },
  };
}

describe('Pre-callback recovery races (optimistic snapshot simulation)', () => {
  it('aborts a late acquisition after recovery won, even when its control push was already in flight', async () => {
    const ctx = setup(),
      pause = ctx.pauseJournalWrite();
    const acquisition = ctx.ownership.beginWrite(claimInput());
    const rejected = expect(acquisition).rejects.toThrow('journal changed');
    await pause.entered;
    await ctx.ownership.recoverWriteBeforeCallback(input);
    pause.resume();
    await rejected;
    expect(ctx.retries()).toBe(1);
    expect(ctx.state().controls[0].activeWrites).toEqual([]);
    expect(ctx.state().journal.lifecycle).toBe('RECOVERED_BEFORE_CALLBACK');
    expect(ctx.state().journal.recovery?.claims[0].tokenRemoved).toBe(false);
  });

  it('retries recovery when an acquisition won and removes the newly committed token', async () => {
    const ctx = setup(),
      pause = ctx.pauseJournalWrite();
    const recovery = ctx.ownership.recoverWriteBeforeCallback(input);
    await pause.entered;
    await ctx.ownership.beginWrite(claimInput());
    pause.resume();
    await recovery;
    expect(ctx.retries()).toBe(1);
    expect(ctx.state().controls[0].activeWrites).toEqual([]);
    expect(ctx.state().journal.recovery?.claims[0]).toEqual({
      animalId: 'a',
      previousState: 'ACQUIRED',
      tokenRemoved: true,
    });
    await expect(ctx.ownership.beginWrite(claimInput('b'))).rejects.toThrow(
      'journal changed',
    );
    expect(ctx.state().controls[1].activeWrites).toEqual([]);
  });

  it('preserves all tokens when MAY_RUN wins while recovery has tentative removals', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    await ctx.ownership.beginWrite(claimInput('b'));
    const pause = ctx.pauseJournalWrite();
    const recovery = ctx.ownership.recoverWriteBeforeCallback(input);
    const rejected = expect(recovery).rejects.toThrow(
      'can no longer be recovered',
    );
    await pause.entered;
    await ctx.journal.permitCallback(handle, 'permitted');
    pause.resume();
    await rejected;
    expect(ctx.state().journal.callback).toBe('MAY_RUN');
    expect(
      ctx
        .state()
        .controls.every((control) => control.activeWrites?.length === 1),
    ).toBe(true);
    // A lost permit acknowledgement can become NOT_INVOKED but never loses
    // durable evidence that permission was granted.
    await ctx.journal.settleCallback(handle, 'NOT_INVOKED', 'after');
    await expect(
      ctx.ownership.recoverWriteBeforeCallback(input),
    ).rejects.toThrow('can no longer be recovered');
  });

  it('prevents callback authorization when recovery wins after all acquisitions', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    await ctx.ownership.beginWrite(claimInput('b'));
    await ctx.ownership.recoverWriteBeforeCallback(input);
    await expect(ctx.journal.permitCallback(handle, 'now')).rejects.toThrow(
      'journal changed',
    );
    expect(
      ctx
        .state()
        .controls.every((control) => control.activeWrites?.length === 0),
    ).toBe(true);
  });

  it('retries the exact recovery after a lost commit reply without touching a later token/reservation', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    ctx.loseCommitReply();
    await expect(
      ctx.ownership.recoverWriteBeforeCallback(input),
    ).rejects.toThrow('Commit reply lost');
    const control = ctx.state().controls[0];
    control.activeWrites?.push({ token: 'another-write', startedAt: 'later' });
    control.transferLock = { transferId: 'later-lock', lockedAt: 'later' };
    const result = await ctx.ownership.recoverWriteBeforeCallback(input);
    expect(result.recovery?.requestId).toBe(input.requestId);
    expect(ctx.state().controls[0]).toEqual(control);
    await expect(
      ctx.ownership.recoverWriteBeforeCallback({
        ...input,
        evidenceRef: 'changed',
      }),
    ).rejects.toThrow('different recovery request');
  });

  it('recovers NOT_INVOKED only when permission was never granted and leaves unrelated legacy tokens/windows intact', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    await ctx.journal.settleCallback(handle, 'NOT_INVOKED', 'after');
    ctx
      .state()
      .controls[0].activeWrites?.push({ token: 'legacy', startedAt: 'old' });
    ctx.state().controls[0].uploadsValidUntil = 'future';
    await ctx.ownership.recoverWriteBeforeCallback(input);
    expect(ctx.state().controls[0].activeWrites).toEqual([
      { token: 'legacy', startedAt: 'old' },
    ]);
    expect(ctx.state().controls[0].uploadsValidUntil).toBe('future');
  });

  it('excludes journals from the previous protocol without upgrading their evidence', async () => {
    const ctx = setup();
    delete ctx.state().journal.protocol;
    await expect(
      ctx.ownership.recoverWriteBeforeCallback(input),
    ).rejects.toThrow('can no longer be recovered');
    await expect(ctx.ownership.beginWrite(claimInput())).rejects.toThrow(
      'journal changed',
    );
    expect(ctx.state().controls[0].activeWrites).toEqual([]);
    expect(ctx.state().journal.protocol).toBeUndefined();
  });

  it('rolls back earlier removals if another animal has a colliding legacy token', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    ctx.state().controls[1].activeWrites?.push({
      token: input.operationId,
      startedAt: 'old',
    });
    await expect(
      ctx.ownership.recoverWriteBeforeCallback(input),
    ).rejects.toThrow('identity is inconsistent');
    expect(ctx.state().controls[0].activeWrites).toHaveLength(1);
    expect(ctx.state().controls[1].activeWrites).toHaveLength(1);
    expect(ctx.state().journal.lifecycle).toBe('OPEN');
    expect(ctx.state().journal.recovery).toBeUndefined();
  });

  it.each([
    { requestId: 'another-request' },
    { operatorId: 'another-operator' },
    { reason: 'INSTANCE_TERMINATION_CONFIRMED' as const },
    { instanceId: 'another-instance' },
  ])('rejects a changed recovery identity/audit %j', async (change) => {
    const ctx = setup();
    await ctx.ownership.recoverWriteBeforeCallback(input);
    const before = clone(ctx.state());
    await expect(
      ctx.ownership.recoverWriteBeforeCallback({ ...input, ...change }),
    ).rejects.toThrow();
    expect(ctx.state()).toEqual(before);
  });

  it('rejects an overlapping second acquisition instead of duplicating the token', async () => {
    const ctx = setup();
    await ctx.ownership.beginWrite(claimInput());
    await expect(ctx.ownership.beginWrite(claimInput())).resolves.toBe(false);
    expect(ctx.state().controls[0].activeWrites).toHaveLength(1);
    expect(ctx.state().journal.claims[0].state).toBe('ACQUIRED');
  });

  it('recovers a lost acquisition commit reply after local NOT_INVOKED without treating it as rollback', async () => {
    const ctx = setup();
    ctx.loseCommitReply();
    await expect(ctx.ownership.beginWrite(claimInput())).rejects.toThrow(
      'Commit reply lost',
    );
    expect(ctx.state().controls[0].activeWrites).toHaveLength(1);
    expect(ctx.state().journal.claims[0].state).toBe('ACQUIRED');
    await ctx.journal.settleCallback(handle, 'NOT_INVOKED', 'after');
    await ctx.journal.finish(handle, 'THREW', 'after');
    expect(ctx.state().journal.lifecycle).toBe('OPEN');
    await ctx.ownership.recoverWriteBeforeCallback(input);
    expect(ctx.state().controls[0].activeWrites).toEqual([]);
    expect(ctx.state().journal.coordinatorOutcome).toBe('THREW');
    expect(ctx.state().journal.recovery?.claims[0].tokenRemoved).toBe(true);
  });

  it('cannot authorize ACQUIRED by updating only the journal INTENT', async () => {
    const ctx = setup();
    await expect(
      ctx.journal.claim(handle, 'a', 'ACQUIRED', 'now'),
    ).rejects.toThrow('journal changed');
    expect(ctx.state().journal.claims[0].state).toBe('INTENT');
    expect(ctx.state().controls[0].activeWrites).toEqual([]);
  });
});
