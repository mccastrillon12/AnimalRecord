import { transferRequestFixture } from '../fixtures/transfer-request.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Pending transfer requests and atomic OTP orchestration, simulated transactions', () => {
  it('creates items, exclusive claims, local notices/outbox and audit in the OTP session without blocking writers', async () => {
    const f = transferRequestFixture(),
      input = await f.authorized(),
      controls = structuredClone(f.db().controls);
    const result = await f.service.create(otpActor, f.id(1), input);
    expect(result.request).toMatchObject({
      status: 'PENDING',
      version: 1,
      animalCount: 2,
      senderId: otpActor,
      recipientId: otpOther,
      reasonName: 'Otro',
    });
    expect(f.otp.state()!.status).toBe('CONSUMED');
    expect(f.otp.store.consume.mock.calls[0].at(-1)).toBe(f.sessions[0]);
    expect(f.db().items).toHaveLength(2);
    expect(f.db().claims).toHaveLength(2);
    expect(f.db().notices).toHaveLength(2);
    expect(f.db().outbox).toHaveLength(2);
    expect(f.db().events).toHaveLength(1);
    expect(f.db().controls.map((c) => ({ ...c, revision: 0 }))).toEqual(
      controls,
    );
    f.db().animals[0].name = 'Edited while pending';
    expect(
      (await f.service.detail(otpOther, result.request.id)).items[0].animalName,
    ).toBe('Animal 1');
  });
  it('replays the same business intent without consuming another proof, including an expired original proof', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized();
    const first = await f.service.create(otpActor, f.id(1), body),
      before = f.snapshot();
    f.otp.advance(20 * 60000);
    const again = await f.service.create(otpActor, f.id(1), {
      ...body,
      animalIds: [...body.animalIds].reverse(),
    });
    expect(again).toEqual({ request: first.request, replayed: true });
    expect(f.snapshot()).toEqual(before);
    expect(f.otp.store.consume).toHaveBeenCalledTimes(1);
    await expect(
      f.service.create(otpActor, f.id(1), {
        ...body,
        animalIds: [body.animalIds[0]],
      }),
    ).rejects.toThrow('already used');
  });
  it('two simultaneous submissions with the same key resolve to one request and one set of events', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized();
    const results = await Promise.all([
      f.service.create(otpActor, f.id(1), body),
      f.service.create(otpActor, f.id(1), body),
    ]);
    expect(results[0].request.id).toBe(results[1].request.id);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(f.db().requests).toHaveLength(1);
    expect(f.db().events).toHaveLength(1);
    expect(f.otp.store.consume).toHaveBeenCalledTimes(1);
  });
  it('rolls back tentative proof consumption and local records on a later outbox failure', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized(),
      before = f.snapshot();
    f.fault.save = true;
    await expect(f.service.create(otpActor, f.id(1), body)).rejects.toThrow(
      'outbox',
    );
    expect(f.snapshot()).toEqual(before);
    expect(f.otp.state()!.status).toBe('VERIFIED');
    f.fault.save = false;
    await f.service.create(otpActor, f.id(1), body);
    expect(f.db().requests).toHaveLength(1);
  });
  it('an explicit replay resolves a lost application reply after simulated commit without recovering or reusing the proof', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized();
    f.fault.lostReply = true;
    await expect(f.service.create(otpActor, f.id(1), body)).rejects.toThrow(
      'reply lost',
    );
    expect(f.otp.state()!.status).toBe('CONSUMED');
    expect(f.db().requests).toHaveLength(1);
    expect((await f.service.create(otpActor, f.id(1), body)).replayed).toBe(
      true,
    );
    expect(f.otp.store.consume).toHaveBeenCalledTimes(1);
  });
  it.each(['recipient', 'reason', 'inactive', 'foreign', 'control'] as const)(
    'rejects invalid %s and preserves the proof after the simulated transaction aborts',
    async (change) => {
      const f = transferRequestFixture(),
        body = await f.authorized();
      if (change === 'recipient') f.db().profiles.pop();
      if (change === 'reason') f.db().reason.isActive = false;
      if (change === 'inactive') f.db().animals[0].isActive = false;
      if (change === 'foreign') f.db().animals[0].ownerId = otpOther;
      if (change === 'control') f.db().controls[0].ownerId = otpOther;
      const before = f.snapshot();
      await expect(f.service.create(otpActor, f.id(1), body)).rejects.toThrow();
      expect(f.snapshot()).toEqual(before);
      expect(f.otp.state()!.status).toBe('VERIFIED');
    },
  );
  it('rejects another active request independently of write locks, without burning the fresh proof on known abort', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized();
    await f.service.create(otpActor, f.id(1), body);
    f.otp.advance(60000);
    const next = await f.authorized();
    const before = f.snapshot();
    await expect(f.service.create(otpActor, f.id(2), next)).rejects.toThrow(
      'active transfer',
    );
    expect(f.snapshot()).toEqual(before);
    expect(f.otp.state()!.status).toBe('VERIFIED');
  });
  it('does not invent an animal count limit or reject legacy-active animals', async () => {
    const f = transferRequestFixture(51),
      body = await f.authorized();
    f.db().animals[0].isActive = undefined;
    expect(
      (await f.service.create(otpActor, f.id(1), body)).request.animalCount,
    ).toBe(51);
    const page = await f.service.detail(otpOther, f.db().requests[0]._id, 50);
    expect(page.items).toHaveLength(50);
    expect(
      (await f.service.detail(otpOther, page.request.id, 50, page.nextCursor))
        .items,
    ).toHaveLength(1);
  });
  it('returns only minimal request metadata to participants and forbids a third party', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized(),
      result = await f.service.create(otpActor, f.id(1), body);
    expect((await f.service.list(otpOther, 'INCOMING')).items[0]).toEqual(
      result.request,
    );
    expect((await f.service.list(otpActor, 'INCOMING')).items).toEqual([]);
    expect((await f.service.list(otpActor, 'OUTGOING')).items).toHaveLength(1);
    await expect(f.service.detail(f.id(90), result.request.id)).rejects.toThrow(
      'participants',
    );
    const publicBody = JSON.stringify(
      await f.service.detail(otpOther, result.request.id),
    );
    expect(publicBody).not.toMatch(
      /bodyHash|authorization|expectedOwner|expectedOwnership|proof|password/,
    );
  });
  it('captures selection and authorization before waiting for storage', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized(),
      originalIds = [...body.animalIds];
    const pending = f.service.create(otpActor, f.id(1), body);
    body.animalIds.length = 0;
    body.authorization.proof = 'x'.repeat(43);
    await pending;
    expect(f.db().items.map((i) => i.animalId)).toEqual(originalIds);
  });
  it('pages requests with timestamp ties and rejects a cursor from another direction or participant', async () => {
    const f = transferRequestFixture(),
      body = await f.authorized();
    await f.service.create(otpActor, f.id(1), {
      ...body,
      animalIds: [body.animalIds[0]],
    });
    f.otp.advance(60000);
    const next = await f.authorized();
    await f.service.create(otpActor, f.id(2), {
      ...next,
      animalIds: [next.animalIds[1]],
    });
    f.db().requests[1].createdAt = f.db().requests[0].createdAt;
    const first = await f.service.list(otpOther, 'INCOMING', 1);
    const second = await f.service.list(
      otpOther,
      'INCOMING',
      1,
      first.nextCursor,
    );
    expect(
      new Set([...first.items, ...second.items].map((r) => r.id)).size,
    ).toBe(2);
    expect(second.nextCursor).toBeUndefined();
    await expect(
      f.service.list(otpOther, 'OUTGOING', 1, first.nextCursor),
    ).rejects.toThrow('cursor');
    await expect(
      f.service.list(otpActor, 'INCOMING', 1, first.nextCursor),
    ).rejects.toThrow('cursor');
    f.db().reason.name = 'Renamed later';
    expect(
      (await f.service.detail(otpOther, first.items[0].id)).request.reasonName,
    ).toBe('Otro');
  });
});
