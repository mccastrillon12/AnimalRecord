import {
  TransferFlowMongoFixture,
  FlowSide,
} from './support/transfer-flow-mongo-fixture';
import { readTransferFlowMongoSettings } from './support/transfer-flow-mongo-safety';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';
import {
  otpActor,
  otpOther,
  transferOtpFixture,
} from '../fixtures/transfer-otp.fixture';
import { installationKey } from '../fixtures/notification-device.fixture';
import { bounded } from './support/write-race-gate';

describe('Opt-in Mongo transfer flow, synthetic account/hash/email/SMS/push ports', () => {
  let f: TransferFlowMongoFixture;
  beforeEach(async () => {
    f = new TransferFlowMongoFixture();
    await f.open(readTransferFlowMongoSettings(process.env));
  });
  afterEach(async () => {
    try {
      await f.close();
      expect(f.push.violations).toEqual([]);
    } finally {
      jest.restoreAllMocks();
    }
  });
  async function pending(count = 2) {
    const seed = await f.seedFlow(count),
      input = await f.requestInput(seed.animalIds);
    const created = await f.left.requests.create(otpActor, id(1), input);
    return { ...seed, input, request: created.request };
  }
  const decision = { expectedVersion: 1, acceptedAnimalIds: [] as string[] };
  async function recipientOutbox() {
    return (await f.left.rows.outbox
      .findOne({ userId: otpOther })
      .lean()
      .exec())!;
  }
  async function readyDelivery() {
    await pending();
    await f.register();
    const outbox = await recipientOutbox();
    const page = await f.left.processor.expand(outbox._id);
    return page.deliveryIds[0];
  }
  async function reject(side: FlowSide, requestId: string, key = id(2)) {
    return side.requests.decide(otpOther, requestId, key, decision);
  }

  it('installs declared indexes only in its namespace, verifies uniqueness and finds no TTL', async () => {
    for (const model of Object.values(f.left.rows)) {
      const indexes = await model.collection.indexes();
      expect(
        indexes.some((index) => index.expireAfterSeconds !== undefined),
      ).toBe(false);
      expect(indexes.some((index) => index.name === '_id_')).toBe(true);
    }
    const attempts = await f.left.rows.attempts.collection.indexes();
    expect(attempts).toContainEqual(
      expect.objectContaining({
        key: { deliveryId: 1, ordinal: 1 },
        unique: true,
      }),
    );
    await f.register();
    await expect(
      f.register(f.right, otpOther, 0, 'synthetic-flow-token', id(51), id(11)),
    ).rejects.toThrow();
    expect(
      await f.right.rows.devices.findById(id(11)).lean().exec(),
    ).toBeNull();
    expect(await f.right.rows.tokens.countDocuments()).toBe(1);
  });
  it('runs OTP → request → inbox/device/push → read → reject → new inbox/push without changing ownership', async () => {
    const s = await pending();
    await f.register();
    const creation = f.commands.filter(
      (c) =>
        c.side === 'left' &&
        c.transaction &&
        [
          'animal_transfer_otp',
          'animal_transfers',
          'animal_transfer_items',
          'animal_transfer_active_items',
          'notifications',
          'notification_outbox',
          'animal_transfer_events',
          'animals',
          'animal_ownership_controls',
        ].includes(c.collection ?? ''),
    );
    expect(new Set(creation.map((c) => c.transaction)).size).toBe(1);
    expect(
      creation.some(
        (c) => c.collection === 'animal_transfer_otp' && c.command === 'update',
      ),
    ).toBe(true);
    expect(f.commands.some((c) => c.side === 'left' && c.snapshot)).toBe(true);
    expect(
      f.commands.some(
        (c) =>
          c.side === 'left' && c.command === 'commitTransaction' && c.majority,
      ),
    ).toBe(true);
    const controls = await f.right.rows.controls.find().lean().exec(),
      animals = await f.right.rows.animals.find().lean().exec();
    expect(await f.left.processor.work()).toEqual(['ACCEPTED']);
    const incoming = await f.right.notifications.list(otpOther);
    expect(incoming.items[0].type).toBe('TRANSFER_REQUEST_RECEIVED');
    await f.right.notifications.markRead(otpOther, incoming.items[0].id);
    expect(await f.left.notifications.unreadCount(otpOther)).toEqual({
      count: 0,
    });
    expect((await reject(f.right, s.request.id)).status).toBe('REJECTED');
    expect(await f.left.processor.work()).toEqual(['ACCEPTED']);
    expect(await f.left.notifications.unreadCount(otpOther)).toEqual({
      count: 1,
    });
    expect(await f.right.rows.claims.countDocuments()).toBe(0);
    expect(await f.right.rows.events.countDocuments()).toBe(2);
    expect(await f.right.rows.controls.find().lean().exec()).toEqual(controls);
    expect(await f.right.rows.animals.find().lean().exec()).toEqual(animals);
    expect(JSON.stringify(f.push.calls.map((call) => call.data))).not.toMatch(
      /name|title|text|itemIds|proof/,
    );
  });
  it('reuses the PHONE registration sender with a synthetic SMS port and real OTP persistence', async () => {
    await f.seedFlow();
    f.left.ports.users.findById.mockResolvedValue(
      transferOtpFixture('PHONE').account,
    );
    const authorization = await f.authorize();
    expect(authorization.proof).toHaveLength(43);
    expect(f.left.ports.sms.send).toHaveBeenCalledTimes(1);
    expect(f.left.ports.email.sendVerificationCode).not.toHaveBeenCalled();
    expect((await f.right.otpStore.find(otpActor))!.status).toBe('VERIFIED');
  });
  it('rolls back consumed OTP, fences and all six request records after a late notice failure', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    const before = await f.right.rows.controls.find().lean().exec();
    f.left.gate.fail = 'NOTICE';
    await expect(
      f.left.requests.create(otpActor, id(1), input),
    ).rejects.toMatchObject({ status: 503 });
    expect((await f.right.otpStore.find(otpActor))!.status).toBe('VERIFIED');
    for (const model of [
      f.right.rows.requests,
      f.right.rows.items,
      f.right.rows.claims,
      f.right.rows.notices,
      f.right.rows.outbox,
      f.right.rows.events,
    ])
      expect(await model.countDocuments()).toBe(0);
    expect(await f.right.rows.controls.find().lean().exec()).toEqual(before);
    expect(
      (await f.right.requests.create(otpActor, id(1), input)).request.status,
    ).toBe('PENDING');
  });
  it('keeps proof usable after a business check aborts following consumption', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    await f.right.rows.reasons.updateOne(
      { code: 'OTHER' },
      { $set: { isActive: false } },
    );
    await expect(
      f.left.requests.create(otpActor, id(1), input),
    ).rejects.toThrow('reason');
    expect((await f.right.otpStore.find(otpActor))!.status).toBe('VERIFIED');
    expect(await f.right.rows.requests.countDocuments()).toBe(0);
  });
  it('rejects OTP consumption with a session from a different client before touching proof', async () => {
    await f.seedFlow();
    const authorization = await f.authorize(),
      session = await f.right.connection.startSession();
    try {
      await expect(
        session.withTransaction(() =>
          f.left.otp.consumeAuthorization(
            otpActor,
            authorization.challengeId,
            authorization.proof,
            session,
          ),
        ),
      ).rejects.toThrow();
    } finally {
      await session.endSession();
    }
    expect((await f.right.otpStore.find(otpActor))!.status).toBe('VERIFIED');
  });
  it('commits one creation receipt under concurrent identical keys and proof', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    const results = await Promise.all([
      f.left.requests.create(otpActor, id(1), input),
      f.right.requests.create(otpActor, id(1), input),
    ]);
    expect(results[0].request.id).toBe(results[1].request.id);
    expect(await f.right.rows.requests.countDocuments()).toBe(1);
    expect(await f.right.rows.events.countDocuments()).toBe(1);
  });
  it('allows one concurrent creation with distinct keys sharing a single-use proof', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    const results = await Promise.allSettled([
      f.left.requests.create(otpActor, id(1), input),
      f.right.requests.create(otpActor, id(2), input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await f.right.rows.requests.countDocuments()).toBe(1);
    expect(await f.right.rows.claims.countDocuments()).toBe(2);
  });
  it('rolls back a fresh proof when an existing active animal claim blocks a second request', async () => {
    const s = await pending();
    f.advance(60000);
    const next = await f.requestInput(s.animalIds);
    await expect(
      f.right.requests.create(otpActor, id(3), next),
    ).rejects.toThrow();
    expect((await f.left.otpStore.find(otpActor))!.status).toBe('VERIFIED');
    expect(await f.right.rows.requests.countDocuments()).toBe(1);
  });
  it('preserves a committed creation after losing the application reply and replays its business receipt', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    f.loseNextCommitReply(f.left);
    await expect(
      f.left.requests.create(otpActor, id(1), input),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (await f.right.requests.create(otpActor, id(1), input)).replayed,
    ).toBe(true);
    expect(await f.right.rows.events.countDocuments()).toBe(1);
  });
  it('rolls back the rejection, released claims and notices on a late failure', async () => {
    const s = await pending();
    f.left.gate.fail = 'NOTICE';
    await expect(reject(f.left, s.request.id)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (await f.right.rows.requests.findById(s.request.id).lean().exec())!
        .status,
    ).toBe('PENDING');
    expect(await f.right.rows.claims.countDocuments()).toBe(2);
    expect(await f.right.rows.notices.countDocuments()).toBe(2);
    expect(await f.right.rows.items.countDocuments({ status: 'PENDING' })).toBe(
      2,
    );
  });
  it.each(['same', 'different'] as const)(
    'serializes concurrent %s rejection keys using the request CAS',
    async (keys) => {
      const s = await pending(),
        pause = f.left.gate.arm('REJECT');
      const left = f.observe(reject(f.left, s.request.id));
      await pause.entered();
      await reject(f.right, s.request.id, keys === 'same' ? id(2) : id(3));
      pause.release();
      const result = await bounded(left, 'rejection result');
      expect('value' in result).toBe(keys === 'same');
      expect(await f.right.rows.events.countDocuments()).toBe(2);
      expect(await f.right.rows.claims.countDocuments()).toBe(0);
    },
  );
  it('retains committed rejection after losing its application reply and never frees a new request on replay', async () => {
    const s = await pending();
    f.loseNextCommitReply(f.left);
    await expect(reject(f.left, s.request.id)).rejects.toMatchObject({
      status: 503,
    });
    f.advance(60000);
    const input = await f.requestInput(s.animalIds);
    await f.right.requests.create(otpActor, id(3), input);
    expect((await reject(f.right, s.request.id)).status).toBe('REJECTED');
    expect(await f.right.rows.claims.countDocuments()).toBe(2);
    expect(await f.right.rows.events.countDocuments()).toBe(3);
  });
  it.each(['missing', 'extra'] as const)(
    'aborts a rejection with %s claims, without repair or partial release',
    async (kind) => {
      const s = await pending();
      if (kind === 'missing')
        await f.right.rows.claims.deleteOne({ _id: s.animalIds[0] });
      else
        await f.right.rows.claims.create([
          { _id: id(900), transferId: s.request.id },
        ]);
      const count = await f.right.rows.claims.countDocuments();
      await expect(reject(f.left, s.request.id)).rejects.toThrow(
        'inconsistent',
      );
      expect(await f.right.rows.claims.countDocuments()).toBe(count);
      expect(
        (await f.right.rows.requests.findById(s.request.id).lean().exec())!
          .status,
      ).toBe('PENDING');
    },
  );
  it('reads an old but internally coherent snapshot across a concurrent decision without obtaining a fence', async () => {
    const s = await pending();
    await f.left.requestStore.transaction(async (tx) => {
      const old = await tx.find(s.request.id);
      await reject(f.right, s.request.id);
      expect(old!.status).toBe('PENDING');
      expect(
        (await tx.items(s.request.id, 20)).every((i) => i.status === 'PENDING'),
      ).toBe(true);
    });
    expect(
      (await f.left.requests.detail(otpOther, s.request.id)).request.status,
    ).toBe('REJECTED');
  });
  it('rejects a stale item cursor and filters pending cards after rejection', async () => {
    const s = await pending(),
      page = await f.left.requests.detail(otpOther, s.request.id, 1);
    await reject(f.right, s.request.id);
    await expect(
      f.left.requests.detail(otpOther, s.request.id, 1, page.nextCursor),
    ).rejects.toThrow('reload');
    expect(
      (
        await f.left.requests.list(
          otpOther,
          'INCOMING',
          20,
          undefined,
          'PENDING',
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await f.left.requests.list(
          otpOther,
          'INCOMING',
          20,
          undefined,
          'REJECTED',
        )
      ).items,
    ).toHaveLength(1);
  });
  it('keeps the first read timestamp under two clients and does not expose another account inbox', async () => {
    await pending();
    const [notice] = (await f.left.notifications.list(otpOther)).items;
    const [a, b] = await Promise.all([
      f.left.notifications.markRead(otpOther, notice.id),
      f.right.notifications.markRead(otpOther, notice.id),
    ]);
    expect(a.readAt).toBe(b.readAt);
    expect(await f.right.notifications.unreadCount(otpOther)).toEqual({
      count: 0,
    });
    await expect(
      f.left.notifications.markRead(otpActor, notice.id),
    ).rejects.toThrow('not found');
  });
  it('rolls back a token rotation when the new token belongs to another installation', async () => {
    await f.register();
    await f.register(f.right, otpOther, 0, 'occupied-token', id(51), id(11));
    await expect(
      f.register(f.left, otpOther, 1, 'occupied-token', id(52)),
    ).rejects.toThrow();
    expect((await f.right.deviceStore.find(id(10)))!.token).toBe(
      'synthetic-flow-token',
    );
    expect(await f.right.rows.tokens.countDocuments()).toBe(2);
  });
  it('serializes rotation and logout of the same generation, retaining a monotonic tombstone/version', async () => {
    await f.register();
    const result = await Promise.allSettled([
      f.register(f.left, otpOther, 1, 'rotated-token', id(51)),
      f.right.devices.unregister(
        otpOther,
        id(10),
        installationKey,
        id(52),
        '"1"',
      ),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.left.deviceStore.find(id(10)))!.revision).toBe(2);
    expect(await f.left.rows.tokens.countDocuments()).toBe(
      (await f.left.deviceStore.find(id(10)))!.state === 'ACTIVE' ? 1 : 0,
    );
  });
  it('does not let the previous account remove a reassigned installation', async () => {
    await f.register();
    await f.register(f.right, otpActor, 1, 'new-account-token', id(51));
    await expect(
      f.left.devices.unregister(
        otpOther,
        id(10),
        installationKey,
        id(52),
        '"2"',
      ),
    ).rejects.toThrow('not found');
    expect((await f.right.deviceStore.find(id(10)))!.userId).toBe(otpActor);
  });
  it('replays a device operation after application reply loss without issuing another revision', async () => {
    f.loseNextCommitReply(f.left);
    await expect(f.register()).rejects.toMatchObject({ status: 503 });
    expect((await f.register(f.right)).revision).toBe(1);
    expect(await f.right.rows.tokens.countDocuments()).toBe(1);
  });
  it('expands competing fan-out pages without duplicate deliveries and resumes from persisted cursor', async () => {
    await pending();
    await f.register();
    await f.register(f.right, otpOther, 0, 'second-token', id(51), id(11));
    const outbox = await recipientOutbox();
    await Promise.allSettled([
      f.left.processor.expand(outbox._id, 1),
      f.right.processor.expand(outbox._id, 1),
    ]);
    await f.left.processor.expand(outbox._id, 1);
    await f.right.processor.expand(outbox._id, 1);
    expect(
      await f.right.rows.deliveries.countDocuments({ outboxId: outbox._id }),
    ).toBe(2);
    expect(f.push.calls).toHaveLength(0);
  });
  it.each(['logout', 'rotation', 'account'] as const)(
    'denies a permission whose snapshot predates %s before the device fence',
    async (kind) => {
      const delivery = await readyDelivery(),
        pause = f.left.gate.arm('DEVICE_FENCE');
      const send = f.observe(f.left.processor.run(delivery));
      await pause.entered();
      if (kind === 'logout')
        await f.right.devices.unregister(
          otpOther,
          id(10),
          installationKey,
          id(51),
          '"1"',
        );
      else
        await f.register(
          f.right,
          kind === 'account' ? otpActor : otpOther,
          1,
          'new-token',
          id(51),
        );
      pause.release();
      expect(await bounded(send, 'stale grant')).toEqual({
        value: 'NOT_GRANTED',
      });
      expect(f.push.calls).toHaveLength(0);
      expect(await f.right.rows.attempts.countDocuments()).toBe(0);
    },
  );
  it('does not revoke a permission already committed when logout happens during its synthetic send', async () => {
    const delivery = await readyDelivery();
    f.push.before = async () => {
      await f.right.devices.unregister(
        otpOther,
        id(10),
        installationKey,
        id(51),
        '"1"',
      );
    };
    expect(await f.left.processor.run(delivery)).toBe('ACCEPTED');
    expect(f.push.calls).toHaveLength(1);
    expect((await f.right.deviceStore.find(id(10)))!.state).toBe('DISABLED');
  });
  it('grants only one synthetic send to competing processors', async () => {
    const delivery = await readyDelivery();
    const result = await Promise.all([
      f.left.processor.run(delivery),
      f.right.processor.run(delivery),
    ]);
    expect(result.sort()).toEqual(['ACCEPTED', 'NOT_GRANTED']);
    expect(f.push.calls).toHaveLength(1);
  });
  it('does not send or recover by age after a lost application grant acknowledgement', async () => {
    const delivery = await readyDelivery();
    f.loseNextCommitReply(f.left);
    await expect(f.left.processor.run(delivery)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (await f.right.rows.deliveries.findById(delivery).lean().exec())!.state,
    ).toBe('MAY_SEND');
    f.advance(864000000);
    expect(await f.right.processor.run(delivery)).toBe('NOT_GRANTED');
    expect(f.push.calls).toHaveLength(0);
  });
  it('rolls back actual device/delivery fences when attempt persistence fails before a send', async () => {
    const delivery = await readyDelivery();
    f.left.gate.fail = 'ATTEMPT';
    await expect(f.left.processor.run(delivery)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (await f.right.rows.deliveries.findById(delivery).lean().exec())!.state,
    ).toBe('READY');
    expect(
      (await f.right.deviceStore.find(id(10)))!.pushRevision,
    ).toBeUndefined();
    expect(await f.right.rows.attempts.countDocuments()).toBe(0);
    expect(f.push.calls).toHaveLength(0);
  });
  it('retains uncertainty and never resends when persisting the response fails', async () => {
    const delivery = await readyDelivery();
    f.left.gate.fail = 'RESPONSE';
    await expect(f.left.processor.run(delivery)).rejects.toMatchObject({
      status: 503,
    });
    expect(await f.right.processor.run(delivery)).toBe('NOT_GRANTED');
    expect(f.push.calls).toHaveLength(1);
    expect((await f.right.rows.attempts.findOne().lean().exec())!.state).toBe(
      'MAY_SEND',
    );
  });
  it('retries explicit durable rejection with separate permissions and a bounded budget', async () => {
    const delivery = await readyDelivery();
    f.push.outcome = 'RETRYABLE_REJECTION';
    for (let i = 0; i < 3; i++) {
      expect(await f.left.processor.run(delivery)).toBe('RETRYABLE_REJECTION');
      expect(await f.right.processor.run(delivery)).toBe('NOT_GRANTED');
      f.advance(30000);
    }
    expect(f.push.calls).toHaveLength(3);
    expect(await f.right.rows.attempts.countDocuments()).toBe(3);
    expect(new Set(f.push.calls.map((call) => call.attemptId)).size).toBe(3);
  });
  it('keeps a throwing synthetic provider UNKNOWN without retry or invalidating the token', async () => {
    const delivery = await readyDelivery();
    f.push.before = () =>
      Promise.reject(new Error('synthetic transport uncertainty'));
    expect(await f.left.processor.run(delivery)).toBe('UNKNOWN');
    f.advance(864000000);
    expect(await f.right.processor.run(delivery)).toBe('NOT_GRANTED');
    expect((await f.right.deviceStore.find(id(10)))!.state).toBe('ACTIVE');
  });
  it('disables the current invalid token and atomically removes its exact claim', async () => {
    const delivery = await readyDelivery();
    f.push.outcome = 'INVALID_TOKEN';
    expect(await f.left.processor.run(delivery)).toBe('INVALID_TOKEN');
    const device = (await f.right.deviceStore.find(id(10)))!;
    expect(device.state).toBe('DISABLED');
    expect(device.revision).toBe(2);
    expect(device.token).toBeUndefined();
    expect(await f.right.rows.tokens.countDocuments()).toBe(0);
  });
  it.each(['rotation', 'account'] as const)(
    'ignores a late invalid-token response for a newer %s binding',
    async (kind) => {
      const delivery = await readyDelivery();
      f.push.outcome = 'INVALID_TOKEN';
      f.push.before = async () => {
        await f.register(
          f.right,
          kind === 'account' ? otpActor : otpOther,
          1,
          'rotated-token',
          id(51),
        );
      };
      expect(await f.left.processor.run(delivery)).toBe('INVALID_TOKEN');
      const device = (await f.right.deviceStore.find(id(10)))!;
      expect(device.state).toBe('ACTIVE');
      expect(device.revision).toBe(2);
      expect(device.token).toBe('rotated-token');
      expect(await f.right.rows.tokens.countDocuments()).toBe(1);
    },
  );
  it('excludes unmarked old outbox rows instead of retrofitting or adopting them', async () => {
    await pending();
    await f.left.rows.outbox.updateMany({}, { $unset: { pushProtocol: '' } });
    expect(await f.left.processor.work()).toEqual([]);
    expect(await f.right.rows.deliveries.countDocuments()).toBe(0);
  });
  it('fails preflight before consuming proof if a required collection is absent', async () => {
    const s = await f.seedFlow(),
      input = await f.requestInput(s.animalIds);
    await f.left.rows.outbox.collection.drop();
    await expect(
      f.left.requests.create(otpActor, id(1), input),
    ).rejects.toMatchObject({ status: 503 });
    expect((await f.right.otpStore.find(otpActor))!.status).toBe('VERIFIED');
  });
});
