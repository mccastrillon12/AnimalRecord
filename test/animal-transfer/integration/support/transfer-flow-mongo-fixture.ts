import { Connection, Schema } from 'mongoose';
import { TransferOtp } from '../../../../src/context/animal-transfer/application/transfer-otp';
import { TransferRequests } from '../../../../src/context/animal-transfer/application/transfer-requests';
import { CreateTransferRequestInput } from '../../../../src/context/animal-transfer/domain/transfer-request';
import { MongoTransferRequests } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-requests';
import {
  MongoTransferOtp,
  TRANSFER_OTP_MODEL,
  TransferOtpSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp';
import {
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TRANSFER_EVENT_MODEL,
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
  TransferNoticeSchema,
  TransferOutboxSchema,
  TransferEventSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  UserEntity,
  UserSchema,
} from '../../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import { UserRepository } from '../../../../src/context/user/domain/userRepository';
import { UserCodeSender } from '../../../../src/context/user/application/sender/user-code-sender';
import {
  AnimalTransferReasonEntity,
  AnimalTransferReasonSchema,
} from '../../../../src/context/catalogs/infrastructure/persistence/mongo/catalogs.schema';
import { AnimalTransferReasonCode } from '../../../../src/context/catalogs/domain/animal-transfer-reason';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MongoNotifications } from '../../../../src/context/notification/infrastructure/mongo-notifications';
import { Notifications } from '../../../../src/context/notification/application/notifications';
import {
  MongoNotificationDevices,
  NOTIFICATION_DEVICE_MODEL,
  NOTIFICATION_DEVICE_TOKEN_MODEL,
  NotificationDeviceSchema,
  NotificationDeviceTokenSchema,
} from '../../../../src/context/notification/infrastructure/mongo-notification-devices';
import { NotificationDevices } from '../../../../src/context/notification/application/notification-devices';
import { MongoNotificationPush } from '../../../../src/context/notification/infrastructure/mongo-notification-push';
import {
  PUSH_ATTEMPT_MODEL,
  PUSH_DELIVERY_MODEL,
  PushAttemptSchema,
  PushDeliverySchema,
} from '../../../../src/context/notification/infrastructure/notification-push.schema';
import { NotificationPushProcessor } from '../../../../src/context/notification/application/notification-push';
import { NotificationPushProvider } from '../../../../src/context/notification/domain/notification-push';
import {
  transferOtpFixture,
  otpActor,
  otpOther,
} from '../../fixtures/transfer-otp.fixture';
import { promotionTestId as id } from '../../fixtures/media-promotion.fixture';
import { installationKey } from '../../fixtures/notification-device.fixture';
import {
  LocalMongoTestSettings,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';
import { WriteMongoFixture } from './write-mongo-fixture';
import {
  assertOwnedFlowDatabase,
  createFlowNamespace,
  FLOW_COLLECTIONS,
  readTransferFlowMongoSettings,
} from './transfer-flow-mongo-safety';
import { FlowRaceGate } from './transfer-flow-race-gate';

function createSide(
  connection: Connection,
  clock: () => Date,
  provider: NotificationPushProvider,
) {
  const gate = new FlowRaceGate();
  function model<T>(name: string, source: Schema<T>) {
    const schema = source.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    return connection.model<T>(name, schema);
  }
  const requestSchema = TransferRequestSchema.clone();
  requestSchema.pre('updateOne', async function () {
    if (
      (this.getUpdate() as { $set?: { status?: string } }).$set?.status ===
      'REJECTED'
    )
      await gate.before('REJECT');
  });
  const otpSchema = TransferOtpSchema.clone();
  otpSchema.pre('updateOne', async function () {
    if (
      (this.getUpdate() as { $set?: { status?: string } }).$set?.status ===
      'CONSUMED'
    )
      await gate.before('CONSUME');
  });
  const deviceSchema = NotificationDeviceSchema.clone();
  deviceSchema.pre('updateOne', async function () {
    if (
      (this.getUpdate() as { $inc?: { pushRevision?: number } }).$inc
        ?.pushRevision
    )
      await gate.before('DEVICE_FENCE');
  });
  const noticeSchema = TransferNoticeSchema.clone();
  noticeSchema.pre('insertMany', async function () {
    await gate.before('NOTICE');
  });
  const deliverySchema = PushDeliverySchema.clone();
  deliverySchema.pre('insertMany', async function () {
    await gate.before('FANOUT');
  });
  const attemptSchema = PushAttemptSchema.clone();
  attemptSchema.pre('save', async function () {
    await gate.before('ATTEMPT');
  });
  attemptSchema.pre('updateOne', async function () {
    await gate.before('RESPONSE');
  });
  const rows = {
    requests: model(TRANSFER_REQUEST_MODEL, requestSchema),
    items: model(TRANSFER_REQUEST_ITEM_MODEL, TransferRequestItemSchema),
    claims: model(TRANSFER_REQUEST_CLAIM_MODEL, TransferRequestClaimSchema),
    notices: model(TRANSFER_NOTICE_MODEL, noticeSchema),
    outbox: model(TRANSFER_OUTBOX_MODEL, TransferOutboxSchema),
    events: model(TRANSFER_EVENT_MODEL, TransferEventSchema),
    users: model(UserEntity.name, UserSchema),
    reasons: model(AnimalTransferReasonEntity.name, AnimalTransferReasonSchema),
    animals: model(AnimalEntity.name, AnimalSchema),
    controls: model(
      AnimalOwnershipControlEntity.name,
      AnimalOwnershipControlSchema,
    ),
    otps: model(TRANSFER_OTP_MODEL, otpSchema),
    devices: model(NOTIFICATION_DEVICE_MODEL, deviceSchema),
    tokens: model(
      NOTIFICATION_DEVICE_TOKEN_MODEL,
      NotificationDeviceTokenSchema,
    ),
    deliveries: model(PUSH_DELIVERY_MODEL, deliverySchema),
    attempts: model(PUSH_ATTEMPT_MODEL, attemptSchema),
  };
  // Account lookup, hash and actual email/SMS transports remain synthetic. The
  // OTP service, crypto proof generation and every persistence method are real.
  const ports = transferOtpFixture();
  const otpStore = new MongoTransferOtp(rows.otps);
  const otp = new TransferOtp(
    otpStore,
    ports.users as unknown as UserRepository,
    ports.sender as unknown as UserCodeSender,
    ports.hasher,
    ports.policy,
    clock,
  );
  const requestStore = new MongoTransferRequests(
    rows.requests,
    rows.items,
    rows.claims,
    rows.notices,
    rows.outbox,
    rows.events,
    rows.users,
    rows.reasons,
    rows.animals,
    rows.controls,
  );
  const pushStore = new MongoNotificationPush(
    rows.outbox,
    rows.notices,
    rows.devices,
    rows.tokens,
    rows.deliveries,
    rows.attempts,
  );
  return {
    connection,
    gate,
    rows,
    ports,
    otp,
    otpStore,
    requestStore,
    pushStore,
    requests: new TransferRequests(requestStore, otp),
    notifications: new Notifications(new MongoNotifications(rows.notices)),
    deviceStore: new MongoNotificationDevices(rows.devices, rows.tokens),
    devices: new NotificationDevices(
      new MongoNotificationDevices(rows.devices, rows.tokens),
    ),
    processor: new NotificationPushProcessor(
      pushStore,
      provider,
      { maxAttempts: 3, delayMs: 30000 },
      clock,
    ),
  };
}
export type FlowSide = ReturnType<typeof createSide>;
type Send = Parameters<NotificationPushProvider['send']>[0];
export class TransferFlowMongoFixture extends WriteMongoFixture {
  override readonly namespace = createFlowNamespace();
  left!: FlowSide;
  right!: FlowSide;
  private offset = 0;
  readonly clock = () => new Date(Date.now() + this.offset);
  readonly push = {
    outcome: 'ACCEPTED' as Awaited<
      ReturnType<NotificationPushProvider['send']>
    >,
    before: undefined as ((input: Send) => Promise<void>) | undefined,
    calls: [] as Send[],
    violations: [] as string[],
  };
  readonly provider: NotificationPushProvider = {
    send: async (input) => {
      const attempt = await this.right.rows.attempts
        .findById(input.attemptId)
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec();
      const delivery = attempt
        ? await this.right.rows.deliveries
            .findById(attempt.deliveryId)
            .read('primary')
            .readConcern('majority')
            .lean()
            .exec()
        : null;
      if (
        !attempt ||
        attempt.state !== 'MAY_SEND' ||
        delivery?.state !== 'MAY_SEND' ||
        delivery.attemptId !== input.attemptId ||
        this.push.calls.some((call) => call.attemptId === input.attemptId)
      ) {
        this.push.violations.push(
          'Fresh committed permission not observed before simulated send',
        );
        throw new Error('Push fixture refused an unverified/reused permission');
      }
      this.push.calls.push(structuredClone(input));
      await this.push.before?.(input);
      return this.push.outcome;
    },
  };
  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ) {
    assertOwnedFlowDatabase(this.namespace, name, marker, collections);
  }
  protected override monitoredCommands() {
    return [
      ...super.monitoredCommands(),
      'insert',
      'delete',
      'hello',
      'listCollections',
      'listIndexes',
      'create',
      'drop',
      'dropDatabase',
      'listDatabases',
    ];
  }
  protected override clientTimeoutMS(): undefined {
    // Driver 6.20 resolves bulkWrite options twice: an inherited client timeout
    // becomes an illegal operation timeout inside withTransaction. Match the app's
    // absent global CSOT; keep transaction (15s), socket and connection bounds.
    return undefined;
  }
  override async open(settings: LocalMongoTestSettings): Promise<void> {
    const checked = readTransferFlowMongoSettings({
      TRANSFER_FLOW_MONGO_TESTS: '1',
      TRANSFER_FLOW_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    console.info(
      `Disposable flow-test database: ${this.namespace.databaseName}`,
    );
    const connection = await this.connect(checked, 'left'),
      db = connection.db!;
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length)
      throw new Error('Generated flow database was not empty; setup refused');
    await db.createCollection(WRITE_TEST_MARKER);
    await db
      .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
      .insertOne(
        { _id: 'owner', runId: this.namespace.runId },
        { writeConcern: { w: 'majority' } },
      );
    this.ownsDatabase = true;
    this.left = createSide(connection, this.clock, this.provider);
    const names = Object.values(this.left.rows).map(
      (m) => m.collection.collectionName,
    );
    if (
      names.length !== FLOW_COLLECTIONS.length - 1 ||
      new Set(names).size !== names.length ||
      names.some(
        (name) => !(FLOW_COLLECTIONS as readonly string[]).includes(name),
      )
    )
      throw new Error(
        'Flow models must exactly match their own collection allowlist before DDL',
      );
    for (const model of Object.values(this.left.rows)) {
      await model.createCollection();
      await model.createIndexes();
    }
    this.right = createSide(
      await this.connect(checked, 'right'),
      this.clock,
      this.provider,
    );
  }
  advance(ms: number) {
    this.offset += ms;
  }
  async seedFlow(count = 2) {
    const rows = this.left.rows;
    // Minimal synthetic source rows, not signup/animal creation or a backfill.
    await rows.users.collection.insertMany([
      { id: otpActor, name: 'Ana', identificationNumber: 'synthetic-100' },
      { id: otpOther, name: 'Luis', identificationNumber: 'synthetic-200' },
    ]);
    await rows.reasons.create(
      [
        {
          _id: 'OTHER',
          code: AnimalTransferReasonCode.Other,
          name: 'Otro',
          isActive: true,
          sortOrder: 1,
        },
      ],
      { w: 'majority' },
    );
    const animalIds = Array.from({ length: count }, (_, i) => id(100 + i));
    await rows.animals.collection.insertMany(
      animalIds.map((animalId, i) => ({
        id: animalId,
        name: `Animal ${i}`,
        code: `AR-${i}`,
        ownerId: otpActor,
        isActive: true,
      })),
    );
    await rows.controls.collection.insertMany(
      animalIds.map((animalId) => ({
        animalId,
        ownerId: otpActor,
        ownershipVersion: 1,
        activeWrites: [],
      })),
    );
    return { actorId: otpActor, recipientId: otpOther, animalIds };
  }
  async authorize(side = this.left) {
    const challenge = await side.otp.issue(otpActor);
    const proof = await side.otp.verify(
      otpActor,
      challenge.challengeId,
      side.ports.code(),
    );
    return { challengeId: proof.challengeId, proof: proof.proof };
  }
  async requestInput(animalIds: string[]): Promise<CreateTransferRequestInput> {
    return {
      recipientId: otpOther,
      reasonCode: AnimalTransferReasonCode.Other,
      animalIds,
      authorization: await this.authorize(),
    };
  }
  register(
    side = this.left,
    userId = otpOther,
    revision = 0,
    token = 'synthetic-flow-token',
    operationId = id(50),
    installationId = id(10),
  ) {
    return side.devices.register(
      userId,
      installationId,
      installationKey,
      operationId,
      `"${revision}"`,
      { provider: 'FCM', platform: 'ANDROID', token },
    );
  }
  override async drain(): Promise<void> {
    this.left?.gate.releaseAll();
    this.right?.gate.releaseAll();
    await super.drain();
  }
  override async close(): Promise<void> {
    // Keep inherited promise/restorer draining; verify absence before closing the
    // two clients, without broadening prior fixtures' collection allowlists.
    let failure: unknown;
    try {
      await this.drain();
      if (this.ownsDatabase) {
        const db = this.connections[0].db!;
        const marker = await db
          .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
          .findOne({ _id: 'owner' });
        const names = await db
          .listCollections({}, { nameOnly: true })
          .toArray();
        this.assertOwnership(
          db.databaseName,
          marker?.runId,
          names.map((r) => r.name),
        );
        await db.dropDatabase({ writeConcern: { w: 'majority' } });
        this.ownsDatabase = false;
        const remaining = await db.admin().listDatabases({
          nameOnly: true,
          filter: { name: this.namespace.databaseName },
        });
        if (remaining.databases.length)
          throw new Error(
            'Flow namespace absence could not be verified after cleanup',
          );
        console.info(
          `Flow-test namespace verified absent: ${this.namespace.databaseName}`,
        );
      }
    } catch (error) {
      failure = error;
    }
    const closed = await Promise.allSettled(
      this.connections.map((c) => c.close()),
    );
    if (failure !== undefined)
      throw failure instanceof Error
        ? failure
        : new Error('Flow cleanup failed');
    if (closed.some((r) => r.status === 'rejected'))
      throw new Error('Flow connection cleanup failed');
  }
}
