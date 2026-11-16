import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, STATES } from 'mongoose';
import { validate as isUuid, v5 as uuidV5 } from 'uuid';
import { createHash } from 'node:crypto';
import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
} from '../../animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { NotificationRecord, NOTIFICATION_TYPES } from '../domain/notification';
import { DeviceRecord } from '../domain/notification-device';
import {
  NotificationPushStore,
  PUSH_PROTOCOL,
  PushAttempt,
  PushDelivery,
  PushGrant,
  PushOutcome,
  PushOutbox,
  PushRetryPolicy,
} from '../domain/notification-push';
import {
  DeviceTokenClaim,
  NOTIFICATION_DEVICE_MODEL,
  NOTIFICATION_DEVICE_TOKEN_MODEL,
} from './mongo-notification-devices';
import {
  PUSH_ATTEMPT_MODEL,
  PUSH_DELIVERY_MODEL,
} from './notification-push.schema';

const unavailable = () =>
  new ServiceUnavailableException(
    'Push storage or transaction outcome could not be verified; no permission may be reconstructed',
  );
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const hex = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const integer = (n: unknown, minimum = 0): n is number =>
  Number.isSafeInteger(n) &&
  (n as number) >= minimum &&
  (n as number) < Number.MAX_SAFE_INTEGER;
const date = (s: unknown): s is string =>
  typeof s === 'string' &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString() === s;
export const pushDeliveryId = (outboxId: string, installationId: string) =>
  uuidV5(
    `https://animalrecord.app/push/${outboxId}/${installationId}`,
    uuidV5.URL,
  );

@Injectable()
export class MongoNotificationPush implements NotificationPushStore {
  constructor(
    @InjectModel(TRANSFER_OUTBOX_MODEL)
    private readonly outbox: Model<PushOutbox>,
    @InjectModel(TRANSFER_NOTICE_MODEL)
    private readonly notices: Model<NotificationRecord>,
    @InjectModel(NOTIFICATION_DEVICE_MODEL)
    private readonly devices: Model<DeviceRecord>,
    @InjectModel(NOTIFICATION_DEVICE_TOKEN_MODEL)
    private readonly tokens: Model<DeviceTokenClaim>,
    @InjectModel(PUSH_DELIVERY_MODEL)
    private readonly deliveries: Model<PushDelivery>,
    @InjectModel(PUSH_ATTEMPT_MODEL)
    private readonly attempts: Model<PushAttempt>,
  ) {}
  async pending(limit: number): Promise<string[]> {
    try {
      const rows = await this.outbox
        .find({
          pushProtocol: PUSH_PROTOCOL,
          status: { $in: ['PENDING', 'EXPANDING'] },
        })
        .select({ _id: 1 })
        .sort({ createdAt: 1, _id: 1 })
        .limit(limit)
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .lean()
        .exec();
      return rows.map((r) => r._id);
    } catch {
      throw unavailable();
    }
  }
  async ready(limit: number, at: string): Promise<string[]> {
    try {
      const rows = await this.deliveries
        .find({ state: 'READY', nextAttemptAt: { $lte: at } })
        .select({ _id: 1 })
        .sort({ nextAttemptAt: 1, _id: 1 })
        .limit(limit)
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .lean()
        .exec();
      return rows.map((r) => r._id);
    } catch {
      throw unavailable();
    }
  }
  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    let session: ClientSession | undefined;
    try {
      const connection = this.outbox.db,
        db = connection.db;
      if (
        !db ||
        connection.readyState !== STATES.connected ||
        [
          this.notices,
          this.devices,
          this.tokens,
          this.deliveries,
          this.attempts,
        ].some((m) => m.db !== connection)
      )
        throw unavailable();
      const hello = (await db
        .admin()
        .command(
          { hello: 1 },
          { readPreference: 'primary', timeoutMS: 5000 },
        )) as {
        setName?: unknown;
        isWritablePrimary?: unknown;
        logicalSessionTimeoutMinutes?: unknown;
        msg?: unknown;
      };
      if (
        typeof hello.setName !== 'string' ||
        !hello.setName ||
        hello.isWritablePrimary !== true ||
        typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
        !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
        hello.logicalSessionTimeoutMinutes <= 0 ||
        hello.msg !== undefined
      )
        throw unavailable();
      const names = [
        'notification_outbox',
        'notifications',
        'notification_devices',
        'notification_device_tokens',
        'notification_push_deliveries',
        'notification_push_attempts',
      ];
      const collections = await db
        .listCollections(
          { name: { $in: names } },
          { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
        )
        .toArray();
      if (
        names.some(
          (name) =>
            !collections.some(
              (c) =>
                c.name === name &&
                c.type === 'collection' &&
                c.options?.capped !== true &&
                !c.options?.timeseries,
            ),
        )
      )
        throw unavailable();
      session = await connection.startSession();
      const active = session;
      return await active.withTransaction(() => work(active), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxCommitTimeMS: 5000,
        timeoutMS: 15000,
      });
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpException)
        throw error;
      throw unavailable();
    } finally {
      if (session) await session.endSession();
    }
  }
  private async source(
    outboxId: string,
    session: ClientSession,
  ): Promise<PushOutbox> {
    const row = await this.outbox
      .findById(outboxId)
      .session(session)
      .lean()
      .exec();
    if (
      !row ||
      row.pushProtocol !== PUSH_PROTOCOL ||
      !isUuid(row._id) ||
      !isUuid(row.notificationId) ||
      !isUuid(row.transferId) ||
      !isUuid(row.userId) ||
      !['PENDING', 'EXPANDING', 'EXPANDED'].includes(row.status) ||
      !integer(row.revision) ||
      !date(row.createdAt) ||
      (row.cursor !== undefined && !isUuid(row.cursor)) ||
      (row.status === 'PENDING' &&
        (row.revision !== 0 || row.cursor !== undefined))
    )
      throw unavailable();
    const notice = await this.notices
      .findOne({
        _id: row.notificationId,
        userId: row.userId,
        transferId: row.transferId,
        type: { $in: [...NOTIFICATION_TYPES] },
      })
      .session(session)
      .lean()
      .exec();
    if (!notice) throw unavailable();
    return row;
  }
  async expand(outboxId: string, pageSize: number) {
    return this.transaction(async (session) => {
      const row = await this.source(outboxId, session);
      if (row.status === 'EXPANDED') return { deliveryIds: [], done: true };
      const devices = await this.devices
        .find({
          userId: row.userId,
          state: 'ACTIVE',
          ...(row.cursor ? { _id: { $gt: row.cursor } } : {}),
        })
        .select({
          _id: 1,
          userId: 1,
          state: 1,
          provider: 1,
          revision: 1,
          tokenHash: 1,
        })
        .collation({ locale: 'simple' })
        .sort({ _id: 1 })
        .limit(pageSize + 1)
        .session(session)
        .lean()
        .exec();
      const page = devices.slice(0, pageSize),
        done = devices.length <= pageSize;
      let previous = row.cursor ?? '';
      const rows = page.map((device): PushDelivery => {
        if (
          !isUuid(device._id) ||
          device._id <= previous ||
          device.userId !== row.userId ||
          device.state !== 'ACTIVE' ||
          device.provider !== 'FCM' ||
          !integer(device.revision, 1) ||
          !hex(device.tokenHash)
        )
          throw unavailable();
        previous = device._id;
        return {
          _id: pushDeliveryId(row._id, device._id),
          outboxId: row._id,
          notificationId: row.notificationId,
          transferId: row.transferId,
          userId: row.userId,
          installationId: device._id,
          deviceRevision: device.revision,
          tokenHash: device.tokenHash,
          state: 'READY',
          attempts: 0,
          nextAttemptAt: row.createdAt,
        };
      });
      if (rows.length)
        await this.deliveries.insertMany(rows, { session, ordered: true });
      const written = await this.outbox
        .updateOne(
          {
            _id: row._id,
            pushProtocol: PUSH_PROTOCOL,
            status: row.status,
            revision: row.revision,
          },
          {
            $set: {
              status: done ? 'EXPANDED' : 'EXPANDING',
              ...(page.length ? { cursor: previous } : {}),
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (written.matchedCount !== 1 || written.modifiedCount !== 1)
        throw new ConflictError('Push expansion changed');
      return { deliveryIds: rows.map((r) => r._id), done };
    });
  }
  async grant(
    deliveryId: string,
    attemptId: string,
    at: string,
  ): Promise<PushGrant | null> {
    return this.transaction(async (session) => {
      const d = await this.deliveries
        .findById(deliveryId)
        .session(session)
        .lean()
        .exec();
      if (!d || d.state !== 'READY') return null;
      if (
        !isUuid(d._id) ||
        !isUuid(d.outboxId) ||
        !isUuid(d.installationId) ||
        d._id !== pushDeliveryId(d.outboxId, d.installationId) ||
        !integer(d.attempts) ||
        !integer(d.deviceRevision, 1) ||
        !hex(d.tokenHash) ||
        !date(d.nextAttemptAt) ||
        !date(at) ||
        !isUuid(attemptId)
      )
        throw unavailable();
      if (d.nextAttemptAt > at) return null;
      if (d.attempts === 0) {
        if (d.attemptId !== undefined || d.outcome !== undefined)
          throw unavailable();
      } else {
        if (
          !d.attemptId ||
          !isUuid(d.attemptId) ||
          d.outcome !== 'RETRYABLE_REJECTION'
        )
          throw unavailable();
        const rejection = await this.attempts
          .findOne({
            _id: d.attemptId,
            deliveryId: d._id,
            ordinal: d.attempts,
            state: 'RESPONDED',
            outcome: 'RETRYABLE_REJECTION',
          })
          .session(session)
          .lean()
          .exec();
        if (!rejection) throw unavailable();
      }
      const source = await this.source(d.outboxId, session);
      if (
        source.userId !== d.userId ||
        source.notificationId !== d.notificationId ||
        source.transferId !== d.transferId
      )
        throw unavailable();
      const device = await this.devices
        .findOne({
          _id: d.installationId,
          userId: d.userId,
          revision: d.deviceRevision,
          tokenHash: d.tokenHash,
          state: 'ACTIVE',
          provider: 'FCM',
        })
        .select('+token')
        .session(session)
        .lean()
        .exec();
      if (!device) {
        const skipped = await this.deliveries
          .updateOne(
            { _id: d._id, state: 'READY', attempts: d.attempts },
            { $set: { state: 'SKIPPED' } },
            { session },
          )
          .exec();
        if (skipped.modifiedCount !== 1)
          throw new ConflictError('Push delivery changed');
        return null;
      }
      if (
        typeof device.token !== 'string' ||
        !device.token ||
        hash(device.token) !== d.tokenHash ||
        (device.pushRevision !== undefined && !integer(device.pushRevision))
      )
        throw unavailable();
      const claim = await this.tokens
        .findOne({
          _id: d.tokenHash,
          installationId: d.installationId,
          revision: d.deviceRevision,
        })
        .session(session)
        .lean()
        .exec();
      if (!claim) throw unavailable();
      // A real write on the binding serializes this grant with rotation/logout.
      // A snapshot read, token existence or expired lease is not permission.
      const fenced = await this.devices
        .updateOne(
          {
            _id: d.installationId,
            userId: d.userId,
            revision: d.deviceRevision,
            tokenHash: d.tokenHash,
            state: 'ACTIVE',
          },
          { $inc: { pushRevision: 1 } },
          { session },
        )
        .exec();
      if (fenced.matchedCount !== 1 || fenced.modifiedCount !== 1)
        throw new ConflictError('Push device changed');
      const ordinal = d.attempts + 1;
      const granted = await this.deliveries
        .updateOne(
          { _id: d._id, state: 'READY', attempts: d.attempts },
          {
            $set: { state: 'MAY_SEND', attemptId },
            $unset: { outcome: '' },
            $inc: { attempts: 1 },
          },
          { session },
        )
        .exec();
      if (granted.matchedCount !== 1 || granted.modifiedCount !== 1)
        throw new ConflictError('Push delivery changed');
      await this.attempts.create(
        [
          {
            _id: attemptId,
            deliveryId,
            ordinal,
            state: 'MAY_SEND',
            grantedAt: at,
          },
        ],
        { session },
      );
      return {
        deliveryId,
        attemptId,
        ordinal,
        token: device.token,
        data: {
          notificationId: d.notificationId,
          transferId: d.transferId,
          recipientId: d.userId,
        },
      };
    });
  }
  async finish(
    grant: PushGrant,
    outcome: PushOutcome,
    at: string,
    policy: PushRetryPolicy,
  ): Promise<void> {
    await this.transaction(async (session) => {
      const d = await this.deliveries
        .findOne({
          _id: grant.deliveryId,
          state: 'MAY_SEND',
          attemptId: grant.attemptId,
          attempts: grant.ordinal,
        })
        .session(session)
        .lean()
        .exec();
      if (!d)
        throw new ConflictError(
          'Push response no longer matches its permission',
        );
      const retry =
        outcome === 'RETRYABLE_REJECTION' && d.attempts < policy.maxAttempts;
      const attempt = await this.attempts
        .updateOne(
          {
            _id: grant.attemptId,
            deliveryId: d._id,
            ordinal: d.attempts,
            state: 'MAY_SEND',
          },
          { $set: { state: 'RESPONDED', outcome, respondedAt: at } },
          { session },
        )
        .exec();
      if (attempt.matchedCount !== 1 || attempt.modifiedCount !== 1)
        throw new ConflictError('Push response was already recorded');
      const changed = await this.deliveries
        .updateOne(
          {
            _id: d._id,
            state: 'MAY_SEND',
            attemptId: grant.attemptId,
            attempts: d.attempts,
          },
          {
            $set: {
              state: retry ? 'READY' : 'RECORDED',
              outcome,
              ...(retry
                ? {
                    nextAttemptAt: new Date(
                      Date.parse(at) + policy.delayMs,
                    ).toISOString(),
                  }
                : {}),
            },
          },
          { session },
        )
        .exec();
      if (changed.matchedCount !== 1 || changed.modifiedCount !== 1)
        throw new ConflictError('Push delivery changed');
      if (outcome === 'INVALID_TOKEN') {
        // An old response cannot disable a rotated/reassigned token or account.
        const disabled = await this.devices
          .updateOne(
            {
              _id: d.installationId,
              userId: d.userId,
              revision: d.deviceRevision,
              tokenHash: d.tokenHash,
              state: 'ACTIVE',
            },
            {
              $set: { state: 'DISABLED', updatedAt: at },
              $inc: { revision: 1 },
              $unset: { token: '', tokenHash: '' },
            },
            { session },
          )
          .exec();
        if (disabled.modifiedCount === 1) {
          const removed = await this.tokens
            .deleteOne(
              {
                _id: d.tokenHash,
                installationId: d.installationId,
                revision: d.deviceRevision,
              },
              { session },
            )
            .exec();
          if (removed.deletedCount !== 1)
            throw new ConflictError('Push token assignment is inconsistent');
        }
      }
    });
  }
}
