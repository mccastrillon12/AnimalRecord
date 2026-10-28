import { randomUUID } from 'node:crypto';
import { MediaPromotionRecordSchema } from '../../../src/context/animal-media/infrastructure/media-promotion-record.schema';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';
import { MediaPromotionMongoFixture } from './support/media-promotion-mongo-fixture';
import { readMediaPromotionMongoSettings } from './support/media-promotion-mongo-safety';

// Only the dedicated config discovers this suite. No AWS client or app startup.
describe('Media promotion persistence in an explicitly selected disposable replica set', () => {
  let fixture: MediaPromotionMongoFixture;
  beforeEach(async () => {
    fixture = new MediaPromotionMongoFixture();
    await fixture.open(readMediaPromotionMongoSettings(process.env));
  });
  afterEach(async () => {
    await fixture.close();
  });

  it('installs exactly the declared indexes without TTL and uses independent clients', async () => {
    expect(fixture.left.connection.getClient()).not.toBe(
      fixture.right.connection.getClient(),
    );
    const indexes = await fixture.left.records.collection.indexes();
    expect(indexes).toHaveLength(
      MediaPromotionRecordSchema.indexes().length + 1,
    );
    for (const [key, options] of MediaPromotionRecordSchema.indexes()) {
      const actual = indexes.find(
        (index) => JSON.stringify(index.key) === JSON.stringify(key),
      );
      expect(actual).toBeDefined();
      expect(actual?.unique === true).toBe(options.unique === true);
      expect(actual?.partialFilterExpression).toEqual(
        options.partialFilterExpression,
      );
    }
    expect(
      indexes.some((index) => index.expireAfterSeconds !== undefined),
    ).toBe(false);
  });

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'persists %s grant, UNKNOWN then late ACK/MATCH without discharging authorization',
    async (kind) => {
      const s = await fixture.seedPromotion(kind);
      await s.prepare();
      const start = fixture.commands.length;
      await fixture.left.repository.apply(s.selection, 2, s.authorize);
      const commands = fixture.commands.slice(start);
      const transactions = new Set(commands.map((event) => event.transaction));
      expect(transactions.size).toBe(1);
      expect(transactions.has(undefined)).toBe(false);
      expect(commands.some((event) => event.snapshot)).toBe(true);
      expect(
        commands.some(
          (event) => event.command === 'commitTransaction' && event.majority,
        ),
      ).toBe(true);
      for (const collection of [
        'animal_write_journals',
        'animal_ownership_controls',
        'animal_media_promotion_records',
      ])
        expect(
          commands.some(
            (event) =>
              event.command === 'update' && event.collection === collection,
          ),
        ).toBe(true);
      const response = {
        type: 'RECORD_RESPONSE' as const,
        effectId: s.effectId,
        attemptId: s.attemptId,
        responseId: randomUUID(),
        outcome: 'UNKNOWN' as const,
        evidenceRef: 'test:lost-remote-reply',
      };
      await fixture.left.repository.apply(s.selection, 3, response);
      await fixture.right.repository.revoke(s.selection, 4, s.audit);
      await fixture.right.journal.settleCallback(
        s.handle,
        'RETURNED',
        s.journal.createdAt,
      );
      await fixture.right.ownership.endWrite(s.animalId, s.handle.id);
      await fixture.right.journal.claim(
        s.handle,
        s.animalId,
        'RELEASED',
        s.journal.createdAt,
      );
      await fixture.right.journal.finish(
        s.handle,
        'RETURNED',
        s.journal.createdAt,
      );
      await fixture.left.repository.apply(s.selection, 5, {
        ...response,
        responseId: randomUUID(),
        outcome: 'ACKNOWLEDGED',
      });
      const observationId = randomUUID();
      await fixture.left.repository.apply(s.selection, 6, {
        type: 'OBSERVE_DESTINATION',
        effectId: s.effectId,
        observation: {
          id: observationId,
          finding: 'MATCH',
          evidenceRef: 'test:synthetic-match',
          uploadId: s.upload.id,
          sha256: s.upload.pinned!.sha256,
          revision: { etag: 'synthetic-final', size: 32 },
        },
      });
      expect(
        await fixture.right.repository.read(s.selection, s.attemptId),
      ).toMatchObject({
        coverage: 'INCOMPLETE',
        remoteEffects: 'NOT_ASSESSED',
        gate: { gateRevision: 7, data: { gate: { state: 'REVOKED' } } },
        record: { authorizationId: s.id(11) },
      });
      expect(
        (await fixture.right.repository.read(s.selection, response.responseId))
          .record,
      ).toMatchObject({ data: { outcome: 'UNKNOWN' } });
      expect(
        (await fixture.right.repository.read(s.selection, observationId))
          .record,
      ).toMatchObject({ data: { finding: 'MATCH' } });
      await expect(
        fixture.left.repository.apply(s.selection, 7, {
          ...s.intention,
          attemptId: randomUUID(),
          origin: 'SDK_RETRY',
          previousAttemptId: s.attemptId,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it.each(['id', 'identityIds', 'upload', 'destination', 'ordinal'] as const)(
    'enforces the real %s uniqueness index (deliberate raw fixture collision)',
    async (key) => {
      const s = await fixture.seedPromotion();
      await s.prepare();
      await fixture.left.repository.apply(s.selection, 2, s.authorize);
      const before = await fixture.snapshot();
      const original = before.records.find(
        (row) => row.id === (key === 'ordinal' ? s.attemptId : s.effectId),
      )!;
      const id: string = randomUUID();
      const copy = {
        ...original,
        _id: undefined,
        id,
        identityIds: [id],
        uploadId: randomUUID() as string,
        destinationKey: 'synthetic/other',
      };
      if (key === 'id') copy.id = original.id;
      if (key === 'identityIds') copy.identityIds = [id, s.id(11)];
      if (key === 'upload') copy.uploadId = s.upload.id;
      if (key === 'destination') copy.destinationKey = s.upload.finalKey;
      // For ordinal, original effectId/ordinal remain identical.
      await expect(fixture.right.records.create(copy)).rejects.toMatchObject({
        code: 11000,
      });
      expect(await fixture.snapshot()).toEqual(before);
    },
  );

  it.each(['declaration', 'intention', 'authorization'] as const)(
    'rolls back %s and all tentative fences when final gate CAS matches zero',
    async (stage) => {
      const s = await fixture.seedPromotion();
      await fixture.left.repository.open(s.selection);
      if (stage !== 'declaration')
        await fixture.left.repository.apply(s.selection, 0, s.declaration);
      if (stage === 'authorization')
        await fixture.left.repository.apply(s.selection, 1, s.intention);
      const revision =
        stage === 'declaration' ? 0 : stage === 'intention' ? 1 : 2;
      const command =
        stage === 'declaration'
          ? s.declaration
          : stage === 'intention'
            ? s.intention
            : s.authorize;
      const before = await fixture.snapshot();
      fixture.left.gate.failGateCas = true;
      await expect(
        fixture.left.repository.apply(s.selection, revision, command),
      ).rejects.toThrow('row CAS changed');
      expect(await fixture.snapshot()).toEqual(before);
      // Explicit retry only after durable state has been checked.
      await expect(
        fixture.left.repository.apply(s.selection, revision, command),
      ).resolves.toMatchObject({ gateRevision: revision + 1 });
    },
  );

  it.each(['open', 'tombstone'] as const)(
    'serializes missing-gate competition when %s wins',
    async (winner) => {
      const s = await fixture.seedPromotion();
      const pause = fixture.left.gate.arm('JOURNAL_FENCE');
      const pending = fixture.observe(
        winner === 'open'
          ? fixture.left.repository.revoke(s.selection, undefined, s.audit)
          : fixture.left.repository.open(s.selection),
      );
      await pause.entered();
      if (winner === 'open') await fixture.right.repository.open(s.selection);
      else
        await fixture.right.repository.revoke(s.selection, undefined, s.audit);
      pause.release();
      const result = await pending;
      expect('error' in result && result.error).toBeInstanceOf(ConflictError);
      const state = await fixture.snapshot();
      expect(state.records).toHaveLength(1);
      expect(state.records[0].data).toMatchObject({
        gate: { state: winner === 'open' ? 'OPEN' : 'REVOKED' },
      });
      expect(state.journal?.mediaPromotionRevision).toBe(1);
      if (winner === 'open') {
        await fixture.left.repository.revoke(s.selection, 0, s.audit);
      }
      await expect(
        fixture.right.repository.open(s.selection),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it.each(['authorization', 'revocation'] as const)(
    'serializes permission competition when %s wins',
    async (winner) => {
      const s = await fixture.seedPromotion();
      await s.prepare();
      const pause = fixture.left.gate.arm(
        winner === 'authorization' ? 'GATE_WRITE' : 'JOURNAL_FENCE',
      );
      const pending = fixture.observe(
        winner === 'authorization'
          ? fixture.left.repository.revoke(s.selection, 2, s.audit)
          : fixture.left.repository.apply(s.selection, 2, s.authorize),
      );
      await pause.entered();
      if (winner === 'authorization')
        await fixture.right.repository.apply(s.selection, 2, s.authorize);
      else await fixture.right.repository.revoke(s.selection, 2, s.audit);
      pause.release();
      const result = await pending;
      expect('error' in result && result.error).toBeInstanceOf(ConflictError);
      const read = await fixture.right.repository.read(
        s.selection,
        s.attemptId,
      );
      expect(read.gate?.gateRevision).toBe(3);
      if (winner === 'authorization') {
        expect(read.record).toMatchObject({ authorizationId: s.id(11) });
        await fixture.left.repository.revoke(s.selection, 3, s.audit);
        expect(
          (await fixture.right.repository.read(s.selection, s.attemptId))
            .record,
        ).toMatchObject({ authorizationId: s.id(11) });
      } else expect(read.record).not.toHaveProperty('authorizationId');
    },
  );

  it.each(['authorization', 'settlement'] as const)(
    'fences stale callback state when %s commits first',
    async (winner) => {
      const s = await fixture.seedPromotion();
      await s.prepare();
      const pause = fixture.left.gate.arm(
        winner === 'authorization' ? 'CALLBACK_SETTLE' : 'JOURNAL_FENCE',
      );
      const pending = fixture.observe<unknown>(
        winner === 'authorization'
          ? fixture.left.journal.settleCallback(
              s.handle,
              'THREW',
              s.journal.createdAt,
            )
          : fixture.left.repository.apply(s.selection, 2, s.authorize),
      );
      await pause.entered();
      if (winner === 'authorization')
        await fixture.right.repository.apply(s.selection, 2, s.authorize);
      else
        await fixture.right.journal.settleCallback(
          s.handle,
          'THREW',
          s.journal.createdAt,
        );
      const afterWinner = await fixture.snapshot();
      pause.release();
      const result = await pending;
      if (winner === 'authorization')
        expect(result).toEqual({ value: undefined });
      else {
        // The real driver retries the stale transaction and sees THREW. The
        // domain guard rejects that refreshed journal before another fence.
        expect('error' in result && result.error).toBeInstanceOf(
          InvalidArgumentError,
        );
        expect('error' in result && result.error).toMatchObject({
          message:
            'A permitted ordinary media confirmation journal is required',
        });
        expect(await fixture.snapshot()).toEqual(afterWinner);
      }
      const read = await fixture.right.repository.read(
        s.selection,
        s.attemptId,
      );
      if (winner === 'authorization')
        expect(read.record).toMatchObject({ authorizationId: s.id(11) });
      else expect(read.record).not.toHaveProperty('authorizationId');
      expect((await fixture.right.journal.find(s.handle.id))?.callback).toBe(
        'THREW',
      );
    },
  );

  it('rolls back journal fence and denies a stale permission after linked token removal', async () => {
    const s = await fixture.seedPromotion();
    await s.prepare();
    const pause = fixture.left.gate.arm('CONTROL_FENCE');
    const before = await fixture.snapshot();
    const pending = fixture.observe(
      fixture.left.repository.apply(s.selection, 2, s.authorize),
    );
    await pause.entered();
    await fixture.right.ownership.endWrite(s.animalId, s.handle.id);
    pause.release();
    const result = await pending;
    expect('error' in result && result.error).toBeInstanceOf(ConflictError);
    const after = await fixture.snapshot();
    expect(after.records).toEqual(before.records);
    expect(after.journal).toEqual(before.journal);
    expect(after.control?.activeWrites).toEqual([]);
    expect(after.control?.mediaPromotionRevision).toBe(
      before.control?.mediaPromotionRevision,
    );
  });

  it('keeps an old read-only snapshot without turning it into authorization', async () => {
    const s = await fixture.seedPromotion();
    await s.prepare();
    const session = await fixture.left.connection.startSession();
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      });
      const read = () =>
        fixture.left.records
          .findOne({ id: s.handle.id })
          .session(session)
          .lean()
          .exec();
      expect((await read())?.gateRevision).toBe(2);
      await fixture.right.repository.revoke(s.selection, 2, s.audit);
      expect((await read())?.gateRevision).toBe(2);
      await session.commitTransaction(); // Only reads; no permission written.
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
    await expect(
      fixture.left.repository.apply(s.selection, 2, s.authorize),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await fixture.right.repository.read(s.selection, s.attemptId)).record,
    ).not.toHaveProperty('authorizationId');
  });

  it.each(['open', 'tombstone', 'grant', 'response'] as const)(
    'reconciles lost application reply after confirmed %s commit without replay permission',
    async (stage) => {
      const s = await fixture.seedPromotion();
      if (stage === 'grant' || stage === 'response') await s.prepare();
      if (stage === 'response')
        await fixture.left.repository.apply(s.selection, 2, s.authorize);
      const responseId = randomUUID();
      const perform = () =>
        stage === 'open'
          ? fixture.left.repository.open(s.selection)
          : stage === 'tombstone'
            ? fixture.left.repository.revoke(s.selection, undefined, s.audit)
            : fixture.left.repository.apply(
                s.selection,
                stage === 'grant' ? 2 : 3,
                stage === 'grant'
                  ? s.authorize
                  : {
                      type: 'RECORD_RESPONSE',
                      effectId: s.effectId,
                      attemptId: s.attemptId,
                      responseId,
                      outcome: 'UNKNOWN',
                      evidenceRef: 'test:lost-ack',
                    },
              );
      fixture.loseNextCommitReply(fixture.left);
      await expect(perform()).rejects.toThrow(
        'Injected application commit reply loss',
      );
      const before = await fixture.snapshot();
      const read = await fixture.right.repository.read(
        s.selection,
        stage === 'grant'
          ? s.attemptId
          : stage === 'response'
            ? responseId
            : undefined,
      );
      expect(read.gate).not.toBeNull();
      if (stage === 'grant')
        expect(read.record).toMatchObject({ authorizationId: s.id(11) });
      if (stage === 'response')
        expect(read.record).toMatchObject({ data: { outcome: 'UNKNOWN' } });
      if (stage === 'tombstone')
        expect(read.gate?.data.gate.state).toBe('REVOKED');
      await expect(perform()).rejects.toBeInstanceOf(ConflictError);
      expect(await fixture.snapshot()).toEqual(before);
      expect(read).toMatchObject({
        coverage: 'INCOMPLETE',
        remoteEffects: 'NOT_ASSESSED',
      });
    },
  );

  it('blocks late opening after a tombstone created before callback permission', async () => {
    const s = await fixture.seedPromotion('PROFILE_CONFIRM', false);
    expect((await fixture.right.journal.find(s.handle.id))?.callback).toBe(
      'NOT_STARTED',
    );
    await fixture.left.repository.revoke(s.selection, undefined, s.audit);
    await fixture.right.journal.permitCallback(s.handle, s.journal.createdAt);
    await expect(
      fixture.right.repository.open(s.selection),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await fixture.snapshot()).control?.activeWrites).toHaveLength(1);
  });

  it('rejects existing unmarked MAY_RUN journals without adding protocol or fences', async () => {
    const s = await fixture.seedPromotion('PROFILE_CONFIRM', true, false);
    const before = await fixture.snapshot();
    await expect(fixture.left.repository.open(s.selection)).rejects.toThrow(
      'did not opt into',
    );
    await expect(
      fixture.right.repository.revoke(s.selection, undefined, s.audit),
    ).rejects.toThrow('did not opt into');
    expect(await fixture.snapshot()).toEqual(before);
  });

  it('records application and SDK retries as separate intentions with immutable prior grants', async () => {
    const s = await fixture.seedPromotion();
    await s.prepare();
    await fixture.left.repository.apply(s.selection, 2, s.authorize);
    let previousAttemptId = s.attemptId;
    let revision = 3;
    for (const origin of ['APPLICATION_RETRY', 'SDK_RETRY'] as const) {
      const attemptId = randomUUID(),
        authorizationId = randomUUID(),
        dispatcherInstanceId = randomUUID();
      await fixture.right.repository.apply(s.selection, revision++, {
        type: 'INTEND_ATTEMPT',
        effectId: s.effectId,
        attemptId,
        dispatcherInstanceId,
        origin,
        previousAttemptId,
      });
      await fixture.right.repository.apply(s.selection, revision++, {
        type: 'AUTHORIZE_ATTEMPT',
        effectId: s.effectId,
        attemptId,
        dispatcherInstanceId,
        authorizationId,
      });
      expect(
        (await fixture.left.repository.read(s.selection, attemptId)).record,
      ).toMatchObject({
        authorizationId,
        ordinal: origin === 'APPLICATION_RETRY' ? 2 : 3,
        data: { origin, previousAttemptId },
      });
      previousAttemptId = attemptId;
    }
    expect(
      (await fixture.left.repository.read(s.selection, s.attemptId)).record,
    ).toMatchObject({ authorizationId: s.id(11) });
    expect(
      (await fixture.left.repository.read(s.selection, s.effectId)).record,
    ).toMatchObject({
      data: { attemptCount: 3, lastAttemptId: previousAttemptId },
    });
    // These are synthetic SDK-origin rows; no SDK middleware/send is exercised.
  });
});
