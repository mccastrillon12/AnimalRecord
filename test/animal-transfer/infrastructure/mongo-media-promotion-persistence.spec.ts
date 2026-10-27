import {
  PromotionRow,
  PromotionStoredCommand,
  decodePromotionRow,
} from '../../../src/context/animal-media/domain/media-promotion-persistence';
import {
  promotionStoreFixture,
  PromotionTestRow,
} from '../fixtures/media-promotion-store.fixture';

type Ctx = ReturnType<typeof promotionStoreFixture>;
const row = (ctx: Ctx, id: string) =>
  ctx.state().records.find((r) => r.id === id)!;
const data = (r: PromotionTestRow) => r.data as PromotionTestRow;
const currentRevision = (ctx: Ctx) =>
  row(ctx, ctx.selection.operationId).gateRevision as number;
const mutate = (ctx: Ctx, id: string, change: (r: PromotionTestRow) => void) =>
  ctx.change('records', (rows) => change(rows.find((r) => r.id === id)!));
const response = (
  ctx: Ctx,
  n = 20,
): Extract<PromotionStoredCommand, { type: 'RECORD_RESPONSE' }> => ({
  type: 'RECORD_RESPONSE',
  effectId: ctx.effectId,
  attemptId: ctx.attemptId,
  responseId: ctx.id(n),
  outcome: 'UNKNOWN',
  evidenceRef: 'receipt:lost',
});

describe('Mongo media promotion persistence with optimistic snapshot doubles', () => {
  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'persists separate %s rows and exact evidence without dispatch',
    async (kind) => {
      const ctx = promotionStoreFixture(kind);
      let g = await ctx.prepare();
      g = await ctx.repository.apply(
        ctx.selection,
        g.gateRevision,
        ctx.authorize,
      );
      const attempt = await ctx.repository.read(ctx.selection, ctx.attemptId);
      expect(attempt).toMatchObject({
        coverage: 'INCOMPLETE',
        remoteEffects: 'NOT_ASSESSED',
        record: { authorizationId: ctx.id(11), kind: 'ATTEMPT', ordinal: 1 },
      });
      g = await ctx.repository.apply(
        ctx.selection,
        g.gateRevision,
        response(ctx),
      );
      g = await ctx.repository.revoke(ctx.selection, g.gateRevision, ctx.audit);
      // Evidence remains append-only and can arrive after local callback/claim closure.
      await ctx.journal.settleCallback(
        { id: ctx.selection.operationId, instanceId: ctx.selection.instanceId },
        'RETURNED',
        'later',
      );
      ctx.change('controls', (rows) => {
        rows[0].activeWrites = [];
      });
      g = await ctx.repository.apply(ctx.selection, g.gateRevision, {
        ...response(ctx, 21),
        outcome: 'ACKNOWLEDGED',
      });
      g = await ctx.repository.apply(ctx.selection, g.gateRevision, {
        type: 'OBSERVE_DESTINATION',
        effectId: ctx.effectId,
        observation: {
          id: ctx.id(22),
          finding: 'MATCH',
          evidenceRef: 'read:match',
          uploadId: ctx.upload.id,
          sha256: ctx.upload.pinned!.sha256,
          revision: { etag: 'final', size: 32, versionId: 'v1' },
        },
      });
      expect(g.data.gate).toEqual({ state: 'REVOKED', ...ctx.audit });
      expect(ctx.state().records).toHaveLength(6);
      expect(row(ctx, ctx.attemptId).authorizationId).toBe(ctx.id(11));
      expect(data(row(ctx, ctx.effectId))).toMatchObject({
        attemptCount: 1,
        lastAttemptId: ctx.attemptId,
        definition: {
          bucket: 'animalrecord-test-media',
          destinationKey: ctx.upload.finalKey,
        },
      });
      expect(
        (await ctx.repository.read(ctx.selection, ctx.id(22))).record,
      ).toMatchObject({ kind: 'OBSERVATION', data: { finding: 'MATCH' } });
      expect(
        (await ctx.repository.read(ctx.selection, ctx.id(20))).record,
      ).toMatchObject({ data: { outcome: 'UNKNOWN' } });
      expect(ctx.log.filter((item) => !item.session)).toEqual([
        expect.objectContaining({ kind: 'journals', method: 'updateOne' }),
      ]);
      expect(
        ctx.options.every(
          (o) =>
            JSON.stringify(o) ===
            JSON.stringify({
              readConcern: { level: 'snapshot' },
              writeConcern: { w: 'majority' },
              readPreference: 'primary',
            }),
        ),
      ).toBe(true);
      for (const r of ctx.state().records)
        for (const field of [
          'attempts',
          'responses',
          'observations',
          'payload',
          'uploadUrl',
          'actorId',
        ])
          expect(r).not.toHaveProperty(field);
    },
  );

  it('does not use a caller-supplied upload or refix the stored pin', async () => {
    const ctx = promotionStoreFixture();
    const gate = await ctx.repository.open(ctx.selection);
    ctx.change('uploads', (rows) => {
      (rows[0].pinned as PromotionTestRow).sha256 = 'b'.repeat(64);
    });
    await ctx.repository.apply(ctx.selection, gate.gateRevision, ctx.declare);
    expect(
      (
        data(row(ctx, ctx.effectId)).definition as {
          source: { sha256: string };
        }
      ).source.sha256,
    ).toBe('b'.repeat(64));
    expect(ctx.upload.pinned!.sha256).toBe('a'.repeat(64));
    await expect(
      ctx.repository.apply(ctx.selection, 1, ctx.declare),
    ).rejects.toThrow();
  });

  it.each(['journals', 'controls'] as const)(
    'rolls back all fences/rows after failure in %s',
    async (kind) => {
      const ctx = promotionStoreFixture();
      await ctx.prepare();
      const before = ctx.state();
      ctx.fail(kind, 'updateOne', true);
      await expect(
        ctx.repository.apply(ctx.selection, 2, ctx.authorize),
      ).rejects.toThrow('fence');
      expect(ctx.state()).toEqual(before);
    },
  );
  it('rolls back a new attempt, parent pointer and fences if final gate CAS matches zero', async () => {
    const ctx = promotionStoreFixture();
    let g = await ctx.repository.open(ctx.selection);
    g = await ctx.repository.apply(ctx.selection, g.gateRevision, ctx.declare);
    const before = ctx.state();
    // First record update is the parent effect; fail the gate after it succeeds.
    ctx.fail('records', 'updateOne', true, 1);
    const pending = ctx.repository.apply(
      ctx.selection,
      g.gateRevision,
      ctx.intention,
    );
    await expect(pending).rejects.toThrow('CAS');
    expect(ctx.state()).toEqual(before);
  });
  it('rolls back on insert failure and unique resource/grant identity collisions', async () => {
    const ctx = promotionStoreFixture();
    const g = await ctx.repository.open(ctx.selection);
    let before = ctx.state();
    ctx.fail('records', 'create');
    await expect(
      ctx.repository.apply(ctx.selection, 0, ctx.declare),
    ).rejects.toThrow('Injected');
    expect(ctx.state()).toEqual(before);
    await ctx.repository.apply(ctx.selection, g.gateRevision, ctx.declare);
    before = ctx.state();
    await expect(
      ctx.repository.apply(ctx.selection, 1, {
        ...ctx.declare,
        effectId: ctx.id(40),
      }),
    ).rejects.toThrow('already been used');
    expect(ctx.state()).toEqual(before);
    await ctx.repository.apply(ctx.selection, 1, ctx.intention);
    before = ctx.state();
    await expect(
      ctx.repository.apply(ctx.selection, 2, {
        ...ctx.authorize,
        authorizationId: ctx.effectId,
      }),
    ).rejects.toThrow('already');
    expect(ctx.state()).toEqual(before);
  });

  it('preserves a committed grant after lost reply and forbids replay as another send', async () => {
    const ctx = promotionStoreFixture();
    await ctx.prepare();
    ctx.loseReply();
    await expect(
      ctx.repository.apply(ctx.selection, 2, ctx.authorize),
    ).rejects.toThrow('after commit');
    expect(
      (await ctx.repository.read(ctx.selection, ctx.attemptId)).record,
    ).toMatchObject({ authorizationId: ctx.id(11) });
    await expect(
      ctx.repository.apply(ctx.selection, 2, ctx.authorize),
    ).rejects.toThrow('revision');
    await expect(
      ctx.repository.apply(ctx.selection, 3, ctx.authorize),
    ).rejects.toThrow('already been used');
    const g = await ctx.repository.revoke(ctx.selection, 3, ctx.audit);
    expect(g.data.gate.state).toBe('REVOKED');
    expect(row(ctx, ctx.attemptId).authorizationId).toBe(ctx.id(11));
  });
  it.each(['open', 'revoke', 'declare', 'intent', 'response'] as const)(
    'reconciles lost %s commit without deleting or reapplying evidence',
    async (stage) => {
      const ctx = promotionStoreFixture();
      if (stage === 'open') {
        ctx.loseReply();
        await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
          'after commit',
        );
        expect(
          (await ctx.repository.read(ctx.selection)).gate?.gateRevision,
        ).toBe(0);
        await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
          'already exists',
        );
        return;
      }
      let g = await ctx.repository.open(ctx.selection);
      if (stage === 'revoke') {
        ctx.loseReply();
        await expect(
          ctx.repository.revoke(ctx.selection, g.gateRevision, ctx.audit),
        ).rejects.toThrow('after commit');
        expect(
          (await ctx.repository.read(ctx.selection)).gate?.data.gate,
        ).toEqual({ state: 'REVOKED', ...ctx.audit });
        return;
      }
      if (stage !== 'declare')
        g = await ctx.repository.apply(
          ctx.selection,
          g.gateRevision,
          ctx.declare,
        );
      if (stage === 'response') {
        g = await ctx.repository.apply(
          ctx.selection,
          g.gateRevision,
          ctx.intention,
        );
        g = await ctx.repository.apply(
          ctx.selection,
          g.gateRevision,
          ctx.authorize,
        );
      }
      const command =
        stage === 'declare'
          ? ctx.declare
          : stage === 'intent'
            ? ctx.intention
            : response(ctx);
      ctx.loseReply();
      await expect(
        ctx.repository.apply(ctx.selection, g.gateRevision, command),
      ).rejects.toThrow('after commit');
      const before = ctx.state();
      await expect(
        ctx.repository.apply(ctx.selection, g.gateRevision, command),
      ).rejects.toThrow('revision');
      expect(ctx.state()).toEqual(before);
    },
  );

  it('creates a tombstone before gate opening even if the callback locally finished', async () => {
    const ctx = promotionStoreFixture();
    await ctx.journal.settleCallback(
      { id: ctx.selection.operationId, instanceId: ctx.selection.instanceId },
      'RETURNED',
      'later',
    );
    const g = await ctx.repository.revoke(ctx.selection, undefined, ctx.audit);
    expect(g).toMatchObject({
      gateRevision: 1,
      data: { effectCount: 0, gate: { state: 'REVOKED' } },
    });
    expect(ctx.state().controls[0]).not.toHaveProperty(
      'mediaPromotionRevision',
    );
    await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
      'already exists',
    );
    await expect(
      ctx.repository.apply(ctx.selection, 1, ctx.declare),
    ).rejects.toThrow('revoked');
  });
  it('never adopts an existing gate when the revoker expected absence', async () => {
    const ctx = promotionStoreFixture();
    await ctx.repository.open(ctx.selection);
    const before = ctx.state();
    await expect(
      ctx.repository.revoke(ctx.selection, undefined, ctx.audit),
    ).rejects.toThrow();
    expect(ctx.state()).toEqual(before);
  });
  it.each(['open', 'tombstone'] as const)(
    'serializes a late opener versus %s winner',
    async (winner) => {
      const ctx = promotionStoreFixture();
      const other = ctx.instance();
      const pause = ctx.pause('journals');
      const loser =
        winner === 'open'
          ? other.revoke(ctx.selection, undefined, ctx.audit)
          : other.open(ctx.selection);
      const rejected = expect(loser).rejects.toThrow();
      await pause.entered;
      if (winner === 'open') await ctx.repository.open(ctx.selection);
      else await ctx.repository.revoke(ctx.selection, undefined, ctx.audit);
      pause.resume();
      await rejected;
      expect(ctx.retries()).toBeGreaterThan(0);
      expect(ctx.state().records).toHaveLength(1);
      if (winner === 'open')
        await ctx.repository.revoke(ctx.selection, 0, ctx.audit);
      expect(
        (await ctx.repository.read(ctx.selection)).gate?.data.gate.state,
      ).toBe('REVOKED');
    },
  );
  it.each(['authorize', 'revoke'] as const)(
    'serializes permission and revocation: %s wins',
    async (winner) => {
      const ctx = promotionStoreFixture();
      await ctx.prepare();
      const other = ctx.instance();
      const pause = ctx.pause(winner === 'revoke' ? 'journals' : 'records');
      const loser =
        winner === 'revoke'
          ? other.apply(ctx.selection, 2, ctx.authorize)
          : other.revoke(ctx.selection, 2, ctx.audit);
      const rejected = expect(loser).rejects.toThrow();
      await pause.entered;
      if (winner === 'revoke')
        await ctx.repository.revoke(ctx.selection, 2, ctx.audit);
      else await ctx.repository.apply(ctx.selection, 2, ctx.authorize);
      pause.resume();
      await rejected;
      if (winner === 'authorize')
        await ctx.repository.revoke(ctx.selection, 3, ctx.audit);
      expect(row(ctx, ctx.attemptId).authorizationId).toBe(
        winner === 'authorize' ? ctx.id(11) : undefined,
      );
    },
  );
  it('two dispatchers cannot authorize one attempt or reuse another instance identity', async () => {
    const ctx = promotionStoreFixture();
    await ctx.prepare();
    await expect(
      ctx.repository.apply(ctx.selection, 2, {
        ...ctx.authorize,
        dispatcherInstanceId: ctx.id(99),
      }),
    ).rejects.toThrow('instance');
    const pause = ctx.pause('journals');
    const old = ctx.instance().apply(ctx.selection, 2, ctx.authorize);
    const rejected = expect(old).rejects.toThrow();
    await pause.entered;
    await ctx.repository.apply(ctx.selection, 2, {
      ...ctx.authorize,
      authorizationId: ctx.id(44),
    });
    pause.resume();
    await rejected;
    expect(row(ctx, ctx.attemptId).authorizationId).toBe(ctx.id(44));
  });
  it.each(['settle', 'token', 'reservation'] as const)(
    'a newer %s invalidates an authorizer using an old snapshot',
    async (change) => {
      const ctx = promotionStoreFixture();
      await ctx.prepare();
      const pause = ctx.pause('controls');
      const pending = ctx.repository.apply(ctx.selection, 2, ctx.authorize),
        rejected = expect(pending).rejects.toThrow();
      await pause.entered;
      if (change === 'settle')
        await ctx.journal.settleCallback(
          {
            id: ctx.selection.operationId,
            instanceId: ctx.selection.instanceId,
          },
          'RETURNED',
          'later',
        );
      else
        ctx.change('controls', (rows) => {
          if (change === 'token') rows[0].activeWrites = [];
          else
            rows[0].transferLock = {
              transferId: ctx.id(80),
              lockedAt: 'later',
            };
        });
      pause.resume();
      await rejected;
      expect(row(ctx, ctx.attemptId)).not.toHaveProperty('authorizationId');
      expect(currentRevision(ctx)).toBe(2);
    },
  );
  it('journal terminal closure wins against an opener, without leaving a gate', async () => {
    const ctx = promotionStoreFixture(),
      pause = ctx.pause('journals');
    const pending = ctx.repository.open(ctx.selection),
      rejected = expect(pending).rejects.toThrow();
    await pause.entered;
    await ctx.journal.settleCallback(
      { id: ctx.selection.operationId, instanceId: ctx.selection.instanceId },
      'NOT_INVOKED',
      'later',
    );
    pause.resume();
    await rejected;
    expect(ctx.state().records).toEqual([]);
  });

  it('persists retries by ordinal without reading all attempts/responses or losing old uncertainty', async () => {
    const ctx = promotionStoreFixture();
    let g = await ctx.prepare();
    g = await ctx.repository.apply(
      ctx.selection,
      g.gateRevision,
      ctx.authorize,
    );
    for (let n = 2; n <= 6; n++) {
      const attemptId = ctx.id(100 + n),
        previousAttemptId = n === 2 ? ctx.attemptId : ctx.id(99 + n);
      g = await ctx.repository.apply(ctx.selection, g.gateRevision, {
        ...ctx.intention,
        attemptId,
        origin: n % 2 ? 'APPLICATION_RETRY' : 'SDK_RETRY',
        previousAttemptId,
      });
      g = await ctx.repository.apply(ctx.selection, g.gateRevision, {
        ...ctx.authorize,
        attemptId,
        authorizationId: ctx.id(200 + n),
      });
    }
    expect(data(row(ctx, ctx.effectId))).toMatchObject({
      attemptCount: 6,
      lastAttemptId: ctx.id(106),
    });
    expect(
      ctx.state().records.filter((r) => r.kind === 'ATTEMPT'),
    ).toHaveLength(6);
    const start = ctx.log.length;
    const read = await ctx.repository.read(ctx.selection, ctx.id(106));
    expect(read.record).toMatchObject({
      ordinal: 6,
      authorizationId: ctx.id(206),
    });
    expect(ctx.log.length - start).toBeLessThanOrEqual(5);
    expect(
      (await ctx.repository.read(ctx.selection, ctx.attemptId)).record,
    ).toMatchObject({ ordinal: 1, authorizationId: ctx.id(11) });
    await ctx.repository.revoke(ctx.selection, g.gateRevision, ctx.audit);
    await expect(
      ctx.repository.apply(ctx.selection, g.gateRevision + 1, {
        ...ctx.intention,
        attemptId: ctx.id(107),
        origin: 'SDK_RETRY',
        previousAttemptId: ctx.id(106),
      }),
    ).rejects.toThrow('revoked');
  });

  const invalidBindings: Array<[string, (ctx: Ctx) => void]> = [
    [
      'no durable opt-in',
      (c) =>
        c.change('journals', (rs) => {
          delete rs[0].mediaPromotionProtocol;
        }),
    ],
    [
      'unknown durable opt-in',
      (c) =>
        c.change('journals', (rs) => {
          rs[0].mediaPromotionProtocol = 'OLD';
        }),
    ],
    [
      'legacy protocol',
      (c) =>
        c.change('journals', (rs) => {
          delete rs[0].protocol;
        }),
    ],
    [
      'permission absent',
      (c) =>
        c.change('journals', (rs) => {
          delete rs[0].callbackPermittedAt;
        }),
    ],
    [
      'settled',
      (c) =>
        c.change('journals', (rs) => {
          rs[0].callback = 'RETURNED';
        }),
    ],
    [
      'journal fence corrupt',
      (c) =>
        c.change('journals', (rs) => {
          rs[0].mediaPromotionRevision = null;
        }),
    ],
    [
      'journal fence exhausted',
      (c) =>
        c.change('journals', (rs) => {
          rs[0].mediaPromotionRevision = Number.MAX_SAFE_INTEGER;
        }),
    ],
    [
      'control fence corrupt',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].mediaPromotionRevision = -1;
        }),
    ],
    [
      'control fence exhausted',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].mediaPromotionRevision = Number.MAX_SAFE_INTEGER;
        }),
    ],
    [
      'owner',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].ownerId = c.id(90);
        }),
    ],
    [
      'version',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].ownershipVersion = 3;
        }),
    ],
    [
      'legacy token',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].activeWrites = [{ token: c.selection.operationId }];
        }),
    ],
    [
      'duplicate token',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].activeWrites = [
            ...(rs[0].activeWrites as unknown[]),
            ...(rs[0].activeWrites as unknown[]),
          ];
        }),
    ],
    [
      'null lock',
      (c) =>
        c.change('controls', (rs) => {
          rs[0].transferLock = null;
        }),
    ],
  ];
  it.each(invalidBindings)(
    'fails closed for %s with no gate/fence residue',
    async (_name, change) => {
      const ctx = promotionStoreFixture();
      change(ctx);
      const before = ctx.state();
      await expect(ctx.repository.open(ctx.selection)).rejects.toThrow();
      expect(ctx.state()).toEqual(before);
    },
  );
  it.each([
    'unknown protocol',
    'unknown gate',
    'negative count',
    'missing scope',
    'injected payload',
    'identity alias',
  ] as const)('rejects persisted gate corruption: %s', async (field) => {
    const ctx = promotionStoreFixture();
    await ctx.prepare();
    mutate(ctx, ctx.selection.operationId, (r) => {
      if (field === 'unknown protocol') r.protocol = 'OLD';
      if (field === 'unknown gate') data(r).gate = { state: 'COMPLETE' };
      if (field === 'negative count') data(r).effectCount = -1;
      if (field === 'missing scope') delete data(r).scope;
      if (field === 'injected payload') r.payload = 'private';
      if (field === 'identity alias') r.identityIds = [ctx.effectId];
    });
    const before = ctx.state();
    await expect(ctx.repository.read(ctx.selection)).rejects.toThrow();
    await expect(
      ctx.repository.apply(ctx.selection, 2, ctx.authorize),
    ).rejects.toThrow();
    expect(ctx.state()).toEqual(before);
  });
  it.each([
    'hash',
    'count',
    'last pointer',
    'parent',
    'ordinal',
    'identity',
    'future revision',
  ] as const)(
    'rejects persisted effect/attempt corruption: %s',
    async (field) => {
      const ctx = promotionStoreFixture();
      await ctx.prepare();
      mutate(
        ctx,
        field === 'hash' || field === 'count' || field === 'last pointer'
          ? ctx.effectId
          : ctx.attemptId,
        (r) => {
          if (field === 'hash') data(r).definitionHash = 'wrong';
          if (field === 'count') data(r).attemptCount = undefined;
          if (field === 'last pointer') data(r).lastAttemptId = ctx.id(90);
          if (field === 'parent') r.effectId = ctx.id(90);
          if (field === 'ordinal') r.ordinal = 2;
          if (field === 'identity') r.authorizationId = ctx.id(90);
          if (field === 'future revision') r.gateRevision = 100;
        },
      );
      await expect(
        ctx.repository.read(ctx.selection, ctx.attemptId),
      ).rejects.toThrow();
    },
  );
  it('propagates query failures and refuses dangling response parents or mismatching observations', async () => {
    const ctx = promotionStoreFixture();
    let g = await ctx.prepare();
    g = await ctx.repository.apply(
      ctx.selection,
      g.gateRevision,
      ctx.authorize,
    );
    g = await ctx.repository.apply(
      ctx.selection,
      g.gateRevision,
      response(ctx),
    );
    ctx.fail('records', 'findOne');
    await expect(ctx.repository.read(ctx.selection)).rejects.toThrow(
      'Injected',
    );
    mutate(ctx, ctx.attemptId, (r) => {
      delete r.authorizationId;
      r.identityIds = [r.id];
    });
    await expect(
      ctx.repository.read(ctx.selection, ctx.id(20)),
    ).rejects.toThrow('no authorization');
    await expect(
      ctx.repository.apply(ctx.selection, g.gateRevision, {
        type: 'OBSERVE_DESTINATION',
        effectId: ctx.effectId,
        observation: {
          id: ctx.id(30),
          finding: 'MATCH',
          evidenceRef: 'read:wrong',
          uploadId: ctx.upload.id,
          sha256: 'b'.repeat(64),
          revision: { etag: 'final', size: 32 },
        },
      }),
    ).rejects.toThrow('different content');
  });
  it('returns explicit incomplete observations for absent gates/records and isolates selection', async () => {
    const ctx = promotionStoreFixture();
    expect(await ctx.repository.read(ctx.selection)).toEqual({
      coverage: 'INCOMPLETE',
      remoteEffects: 'NOT_ASSESSED',
      gate: null,
      record: null,
    });
    await ctx.prepare();
    await expect(
      ctx.repository.read({ ...ctx.selection, instanceId: ctx.id(90) }),
    ).rejects.toThrow('selection');
    expect(
      (await ctx.repository.read(ctx.selection, ctx.id(90))).record,
    ).toBeNull();
    const observed = await ctx.repository.read(ctx.selection, ctx.effectId);
    observed.gate!.data.effectCount = 99;
    expect(data(row(ctx, ctx.selection.operationId)).effectCount).toBe(1);
  });
  it('keeps a tombstone whose creation reply was lost, without reopening or retiring a token', async () => {
    const ctx = promotionStoreFixture(),
      control = ctx.state().controls[0];
    ctx.loseReply();
    await expect(
      ctx.repository.revoke(ctx.selection, undefined, ctx.audit),
    ).rejects.toThrow('after commit');
    expect((await ctx.repository.read(ctx.selection)).gate?.data.gate).toEqual({
      state: 'REVOKED',
      ...ctx.audit,
    });
    expect(ctx.state().controls[0]).toEqual(control);
    await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
      'already exists',
    );
  });
  it('a tombstone before callback permission prevents future registration without inventing NOT_INVOKED', async () => {
    const ctx = promotionStoreFixture();
    const control = ctx.state().controls[0];
    ctx.change('journals', (rs) => {
      rs[0].callback = 'NOT_STARTED';
      delete rs[0].callbackPermittedAt;
    });
    await ctx.repository.revoke(ctx.selection, undefined, ctx.audit);
    expect(ctx.state().journals[0].callback).toBe('NOT_STARTED');
    expect(ctx.state().controls[0]).toEqual(control);
    await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
      'already exists',
    );
  });
  it.each(['journal state', 'claim state', 'version'] as const)(
    'rejects an inconsistent %s rather than inventing a tombstone binding',
    async (field) => {
      const ctx = promotionStoreFixture();
      ctx.change('journals', (rs) => {
        if (field === 'journal state') rs[0].lifecycle = 'UNKNOWN';
        else if (field === 'claim state')
          (rs[0].claims as PromotionTestRow[])[0].state = 'UNKNOWN';
        else delete (rs[0].claims as PromotionTestRow[])[0].ownershipVersion;
      });
      const before = ctx.state();
      await expect(
        ctx.repository.revoke(ctx.selection, undefined, ctx.audit),
      ).rejects.toThrow();
      expect(ctx.state()).toEqual(before);
    },
  );
  it('the global identity registry rejects aliasing a grant as a response or an effect ID as revocation', async () => {
    const ctx = promotionStoreFixture();
    let g = await ctx.prepare();
    g = await ctx.repository.apply(
      ctx.selection,
      g.gateRevision,
      ctx.authorize,
    );
    let before = ctx.state();
    await expect(
      ctx.repository.apply(ctx.selection, g.gateRevision, response(ctx, 11)),
    ).rejects.toThrow('already');
    expect(ctx.state()).toEqual(before);
    before = ctx.state();
    await expect(
      ctx.repository.revoke(ctx.selection, g.gateRevision, {
        ...ctx.audit,
        requestId: ctx.effectId,
      }),
    ).rejects.toThrow('already');
    expect(ctx.state()).toEqual(before);
  });
  it('uses an absence CAS distinct from a persisted zero fence', async () => {
    const absent = promotionStoreFixture(),
      zero = promotionStoreFixture();
    zero.change('journals', (rs) => {
      rs[0].mediaPromotionRevision = 0;
    });
    zero.change('controls', (rs) => {
      rs[0].mediaPromotionRevision = 0;
    });
    await absent.repository.open(absent.selection);
    await zero.repository.open(zero.selection);
    expect(
      (
        absent.log.find(
          (e) => e.kind === 'journals' && e.method === 'updateOne',
        )!.filter as PromotionTestRow
      ).mediaPromotionRevision,
    ).toEqual({ $exists: false });
    expect(
      (
        zero.log.find((e) => e.kind === 'journals' && e.method === 'updateOne')!
          .filter as PromotionTestRow
      ).mediaPromotionRevision,
    ).toBe(0);
  });
  it('can inspect observations even when the gate revision is exhausted', async () => {
    const ctx = promotionStoreFixture();
    const g = await ctx.prepare();
    await ctx.repository.apply(ctx.selection, g.gateRevision, {
      type: 'OBSERVE_DESTINATION',
      effectId: ctx.effectId,
      observation: {
        id: ctx.id(40),
        finding: 'MATCH',
        evidenceRef: 'read:final',
        uploadId: ctx.upload.id,
        sha256: ctx.upload.pinned!.sha256,
        revision: { etag: 'final', size: 32 },
      },
    });
    mutate(ctx, ctx.selection.operationId, (r) => {
      r.gateRevision = Number.MAX_SAFE_INTEGER;
    });
    expect(
      (await ctx.repository.read(ctx.selection, ctx.id(40))).record?.kind,
    ).toBe('OBSERVATION');
    await expect(
      ctx.repository.apply(
        ctx.selection,
        Number.MAX_SAFE_INTEGER,
        ctx.authorize,
      ),
    ).rejects.toThrow();
  });
  it('snapshots command identity before awaits instead of accepting a retarget in flight', async () => {
    const ctx = promotionStoreFixture();
    await ctx.repository.open(ctx.selection);
    const command = { ...ctx.declare };
    const pause = ctx.pause('journals');
    const pending = ctx.repository.apply(ctx.selection, 0, command);
    await pause.entered;
    command.effectId = ctx.id(99);
    pause.resume();
    await pending;
    expect(
      (await ctx.repository.read(ctx.selection, ctx.effectId)).record?.id,
    ).toBe(ctx.effectId);
    expect(
      (await ctx.repository.read(ctx.selection, ctx.id(99))).record,
    ).toBeNull();
  });
  it('does not retrofit an old MAY_RUN journal even for an absent-gate tombstone', async () => {
    const ctx = promotionStoreFixture();
    ctx.change('journals', (rs) => {
      delete rs[0].mediaPromotionProtocol;
    });
    const before = ctx.state();
    await expect(
      ctx.repository.revoke(ctx.selection, undefined, ctx.audit),
    ).rejects.toThrow('did not opt');
    expect(ctx.state()).toEqual(before);
  });
  it('rejects models from another connection before starting a session', async () => {
    const ctx = promotionStoreFixture();
    ctx.models.uploads.db = {
      startSession: () => {
        throw new Error('should not start');
      },
    } as never;
    await expect(ctx.repository.open(ctx.selection)).rejects.toThrow(
      'share their Mongo connection',
    );
    expect(ctx.log).toEqual([]);
  });
  it('preserves optional absent source versions and does not persist Mongoose defaults', async () => {
    const ctx = promotionStoreFixture();
    await ctx.prepare();
    const gate = decodePromotionRow(row(ctx, ctx.selection.operationId));
    expect(gate.kind).toBe('GATE');
    expect(
      (data(row(ctx, ctx.effectId)).definition as { source: object }).source,
    ).not.toHaveProperty('versionId');
    expect(
      ctx
        .state()
        .records.every(
          (r) =>
            (r as unknown as PromotionRow).protocol ===
            'MEDIA_PROMOTION_ROWS_V1',
        ),
    ).toBe(true);
  });
});
