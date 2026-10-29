import { transferRequestFixture } from '../fixtures/transfer-request.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Recipient reject-all decision with simulated atomic persistence', () => {
  async function pending(count = 2) {
    const f = transferRequestFixture(count);
    const body = await f.authorized();
    const created = await f.service.create(otpActor, f.id(1), body);
    return {
      ...f,
      request: created.request,
      body,
      decision: { expectedVersion: 1, acceptedAnimalIds: [] as string[] },
    };
  }
  it('rejects the whole stored set, releases request claims and records two new notices/outbox plus one event', async () => {
    const f = await pending();
    const animals = structuredClone(f.db().animals),
      controls = structuredClone(f.db().controls);
    const consumed = f.otp.store.consume.mock.calls.length;
    const result = await f.service.decide(
      otpOther,
      f.request.id,
      f.id(2),
      f.decision,
    );
    expect(result).toMatchObject({
      status: 'REJECTED',
      version: 2,
      decidedAt: expect.any(String) as unknown,
    });
    expect(f.db().items.every((i) => i.status === 'REJECTED')).toBe(true);
    expect(f.db().claims).toEqual([]);
    expect(f.db().notices).toHaveLength(4);
    expect(f.db().outbox).toHaveLength(4);
    expect(f.db().events).toHaveLength(2);
    expect(f.db().animals).toEqual(animals);
    expect(f.db().controls).toEqual(controls);
    expect(f.otp.store.consume.mock.calls).toHaveLength(consumed);
    expect(JSON.stringify(result)).not.toMatch(
      /decisionOperation|decisionExpected|authorization|bodyHash/,
    );
    expect(
      (await f.service.detail(otpActor, f.request.id)).items.map(
        (i) => i.status,
      ),
    ).toEqual(['REJECTED', 'REJECTED']);
  });
  it('replays the exact receipt without new side effects and rejects another operation or version', async () => {
    const f = await pending();
    const result = await f.service.decide(
        otpOther,
        f.request.id,
        f.id(2),
        f.decision,
      ),
      before = f.snapshot();
    expect(
      await f.service.decide(otpOther, f.request.id, f.id(2), f.decision),
    ).toEqual(result);
    expect(f.snapshot()).toEqual(before);
    await expect(
      f.service.decide(otpOther, f.request.id, f.id(3), f.decision),
    ).rejects.toThrow('changed');
    await expect(
      f.service.decide(otpOther, f.request.id, f.id(2), {
        ...f.decision,
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed');
  });
  it.each(['sender', 'outsider'] as const)(
    'refuses %s even with a known request and operation ID',
    async (kind) => {
      const f = await pending(),
        before = f.snapshot();
      await expect(
        f.service.decide(
          kind === 'sender' ? otpActor : f.id(90),
          f.request.id,
          f.id(2),
          f.decision,
        ),
      ).rejects.toThrow('recipient');
      expect(f.snapshot()).toEqual(before);
    },
  );
  it('returns missing for a nonexistent request and conflict for a stale version', async () => {
    const f = await pending();
    await expect(
      f.service.decide(otpOther, f.id(500), f.id(2), f.decision),
    ).rejects.toThrow('not found');
    await expect(
      f.service.decide(otpOther, f.request.id, f.id(2), {
        ...f.decision,
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed');
    expect(f.db().claims).toHaveLength(2);
  });
  it.each([1, 2])(
    'keeps acceptance of %s selected animals disabled with no partial rejection',
    async (count) => {
      const f = await pending(),
        before = f.snapshot();
      await expect(
        f.service.decide(otpOther, f.request.id, f.id(2), {
          expectedVersion: 1,
          acceptedAnimalIds: f.body.animalIds.slice(0, count),
        }),
      ).rejects.toThrow('acceptance is not enabled');
      expect(f.snapshot()).toEqual(before);
    },
  );
  it.each([
    'missing-claim',
    'foreign-claim',
    'extra-claim',
    'missing-item',
    'nonpending-item',
  ] as const)(
    'aborts inconsistent %s instead of repairing or releasing unrelated claims',
    async (kind) => {
      const f = await pending();
      if (kind === 'missing-claim') f.db().claims.pop();
      if (kind === 'foreign-claim') f.db().claims[0].transferId = f.id(500);
      if (kind === 'extra-claim')
        f.db().claims.push({ animalId: f.id(999), transferId: f.request.id });
      if (kind === 'missing-item') f.db().items.pop();
      if (kind === 'nonpending-item') f.db().items[0].status = 'REJECTED';
      const before = f.snapshot();
      await expect(
        f.service.decide(otpOther, f.request.id, f.id(2), f.decision),
      ).rejects.toThrow('inconsistent');
      expect(f.snapshot()).toEqual(before);
    },
  );
  it('rolls back the complete simulated decision if notices/outbox cannot be persisted', async () => {
    const f = await pending(),
      before = f.snapshot();
    f.fault.save = true;
    await expect(
      f.service.decide(otpOther, f.request.id, f.id(2), f.decision),
    ).rejects.toThrow('outbox');
    expect(f.snapshot()).toEqual(before);
    f.fault.save = false;
    expect(
      (await f.service.decide(otpOther, f.request.id, f.id(2), f.decision))
        .status,
    ).toBe('REJECTED');
  });
  it('preserves uncertainty on a simulated lost commit acknowledgement and reconciles only on explicit exact replay', async () => {
    const f = await pending();
    f.fault.lostReply = true;
    await expect(
      f.service.decide(otpOther, f.request.id, f.id(2), f.decision),
    ).rejects.toMatchObject({ status: 503 });
    const before = f.snapshot();
    expect(
      (await f.service.decide(otpOther, f.request.id, f.id(2), f.decision))
        .status,
    ).toBe('REJECTED');
    expect(f.snapshot()).toEqual(before);
  });
  it('serializes competing decisions in the simulator, keeping one result and one set of side effects', async () => {
    const f = await pending();
    const results = await Promise.allSettled([
      f.service.decide(otpOther, f.request.id, f.id(2), f.decision),
      f.service.decide(otpOther, f.request.id, f.id(3), f.decision),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.db().events).toHaveLength(2);
    expect(f.db().outbox).toHaveLength(4);
  });
  it('permits rejection of inactive/edited animals even with existing write tokens and does not clear them', async () => {
    const f = await pending();
    f.db().animals[0].isActive = false;
    f.db().controls[0].transferLock = 'unrelated-lock';
    const before = structuredClone(f.db().controls);
    await f.service.decide(otpOther, f.request.id, f.id(2), f.decision);
    expect(f.db().controls).toEqual(before);
  });
  it('allows a fresh request after rejection with a fresh authorization, preserving the old record', async () => {
    const f = await pending();
    await f.service.decide(otpOther, f.request.id, f.id(2), f.decision);
    f.otp.advance(60000);
    const fresh = await f.authorized();
    const next = await f.service.create(otpActor, f.id(3), fresh);
    expect(next.request.status).toBe('PENDING');
    expect(f.db().requests).toHaveLength(2);
    const before = f.snapshot();
    await f.service.decide(otpOther, f.request.id, f.id(2), f.decision);
    expect(f.snapshot()).toEqual(before);
    expect(
      (await f.service.create(otpActor, f.id(1), f.body)).request.status,
    ).toBe('REJECTED');
    expect(
      (
        await f.service.list(otpOther, 'INCOMING', 20, undefined, 'PENDING')
      ).items.map((r) => r.id),
    ).toEqual([next.request.id]);
    expect(
      (
        await f.service.list(otpOther, 'INCOMING', 20, undefined, 'REJECTED')
      ).items.map((r) => r.id),
    ).toEqual([f.request.id]);
  });
  it('scopes filtered cursors to their status while keeping unfiltered cursor behavior', async () => {
    const f = await pending(3);
    f.db().requests.push({ ...f.db().requests[0], _id: f.id(300) });
    const first = await f.service.list(
      otpOther,
      'INCOMING',
      1,
      undefined,
      'PENDING',
    );
    expect(first.nextCursor).toBeDefined();
    await expect(
      f.service.list(otpOther, 'INCOMING', 1, first.nextCursor, 'REJECTED'),
    ).rejects.toThrow('cursor');
    await expect(
      f.service.list(otpOther, 'INCOMING', 1, first.nextCursor),
    ).rejects.toThrow('cursor');
  });
  it('binds item pagination to the request version and tolerates legacy version-one cursors only until a decision', async () => {
    const f = await pending();
    const page = await f.service.detail(otpOther, f.request.id, 1);
    const legacy = Buffer.from(
      JSON.stringify({
        scope: `${otpOther}:${f.request.id}`,
        animalId: page.items[0].animalId,
      }),
    ).toString('base64url');
    expect(
      (await f.service.detail(otpOther, f.request.id, 1, legacy)).items,
    ).toHaveLength(1);
    await f.service.decide(otpOther, f.request.id, f.id(2), f.decision);
    await expect(
      f.service.detail(otpOther, f.request.id, 1, page.nextCursor),
    ).rejects.toThrow('reload');
    await expect(
      f.service.detail(otpOther, f.request.id, 1, legacy),
    ).rejects.toThrow('reload');
    expect(
      (await f.service.detail(otpOther, f.request.id)).items.every(
        (i) => i.status === 'REJECTED',
      ),
    ).toBe(true);
  });
  it('captures the decision before awaiting storage', async () => {
    const f = await pending(),
      input = { ...f.decision };
    const result = f.service.decide(otpOther, f.request.id, f.id(2), input);
    input.acceptedAnimalIds.push(f.id(100));
    input.expectedVersion = 9;
    expect((await result).status).toBe('REJECTED');
  });
  it.each([0, 1.5, Number.MAX_SAFE_INTEGER, NaN])(
    'rejects invalid version %s before a transaction',
    async (version) => {
      const f = await pending(),
        before = f.sessions.length;
      await expect(
        f.service.decide(otpOther, f.request.id, f.id(2), {
          expectedVersion: version,
          acceptedAnimalIds: [],
        }),
      ).rejects.toThrow('Invalid');
      expect(f.sessions).toHaveLength(before);
    },
  );
});
