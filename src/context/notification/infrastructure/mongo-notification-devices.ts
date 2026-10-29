import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Schema, STATES } from 'mongoose';
import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  DeviceRecord,
  DeviceRegistrationCollision,
  NotificationDeviceStore,
} from '../domain/notification-device';

export const NOTIFICATION_DEVICE_MODEL = 'NotificationDevice';
export const NOTIFICATION_DEVICE_TOKEN_MODEL = 'NotificationDeviceToken';
export type DeviceTokenClaim = {
  _id: string;
  installationId: string;
  revision: number;
};
export const NotificationDeviceSchema = new Schema<DeviceRecord>(
  {
    _id: { type: String, required: true },
    keyHash: { type: String, required: true },
    userId: { type: String, required: true },
    revision: { type: Number, required: true },
    state: { type: String, enum: ['ACTIVE', 'DISABLED'], required: true },
    provider: { type: String, enum: ['FCM'], required: true },
    platform: { type: String, enum: ['ANDROID', 'IOS'], required: true },
    token: { type: String, select: false },
    tokenHash: String,
    updatedAt: { type: String, required: true },
    lastOperationId: { type: String, required: true },
    lastOperationHash: { type: String, required: true },
  },
  {
    collection: 'notification_devices',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
NotificationDeviceSchema.index({ userId: 1, state: 1 });
export const NotificationDeviceTokenSchema = new Schema<DeviceTokenClaim>(
  {
    _id: { type: String, required: true },
    installationId: { type: String, required: true },
    revision: { type: Number, required: true },
  },
  {
    collection: 'notification_device_tokens',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
@Injectable()
export class MongoNotificationDevices implements NotificationDeviceStore {
  constructor(
    @InjectModel(NOTIFICATION_DEVICE_MODEL)
    private readonly devices: Model<DeviceRecord>,
    @InjectModel(NOTIFICATION_DEVICE_TOKEN_MODEL)
    private readonly tokens: Model<DeviceTokenClaim>,
  ) {}
  async find(installationId: string): Promise<DeviceRecord | null> {
    try {
      return await this.devices
        .findById(installationId)
        .select('+token')
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .lean()
        .exec();
    } catch {
      throw new ServiceUnavailableException(
        'Device registration could not be loaded',
      );
    }
  }
  async change(
    installationId: string,
    transition: (current: DeviceRecord | null) => DeviceRecord,
  ): Promise<DeviceRecord> {
    let session: ClientSession | undefined;
    try {
      const connection = this.devices.db,
        db = connection.db;
      if (
        !db ||
        connection.readyState !== STATES.connected ||
        this.tokens.db !== connection
      )
        throw new ServiceUnavailableException(
          'Device storage is not bound to the application database',
        );
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
        throw new ServiceUnavailableException(
          'Device registration requires a replica-set primary with sessions',
        );
      const names = ['notification_devices', 'notification_device_tokens'];
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
        throw new ServiceUnavailableException(
          'Device registration collections must be prepared before use',
        );
      session = await connection.startSession();
      const active = session;
      return await active.withTransaction(
        async () => {
          const current = await this.devices
            .findById(installationId)
            .select('+token')
            .session(active)
            .lean()
            .exec();
          const next = transition(current);
          if (next === current) return next; // Exact last-operation replay, no mutation or token claim adoption.
          if (
            next._id !== installationId ||
            next.revision !== (current?.revision ?? 0) + 1 ||
            (current && next.keyHash !== current.keyHash)
          )
            throw new ConflictError('Invalid device transition');
          if (current) {
            const written = await this.devices
              .replaceOne(
                {
                  _id: installationId,
                  revision: current.revision,
                  keyHash: current.keyHash,
                },
                next,
                { session: active },
              )
              .exec();
            if (written.matchedCount !== 1 || written.modifiedCount !== 1)
              throw new ConflictError('Device revision changed');
            if (current.state === 'ACTIVE') {
              const removed = await this.tokens
                .deleteOne(
                  {
                    _id: current.tokenHash,
                    installationId,
                    revision: current.revision,
                  },
                  { session: active },
                )
                .exec();
              if (removed.deletedCount !== 1)
                throw new ConflictError(
                  'Device token assignment is inconsistent; no automatic repair',
                );
            }
          } else await this.devices.create([next], { session: active });
          if (next.state === 'ACTIVE')
            await this.tokens.create(
              [
                {
                  _id: next.tokenHash,
                  installationId,
                  revision: next.revision,
                },
              ],
              { session: active },
            );
          return next;
        },
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority', wtimeoutMS: 10000 },
          maxCommitTimeMS: 5000,
          timeoutMS: 15000,
        },
      );
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpException)
        throw error;
      if ((error as { code?: number })?.code === 11000)
        throw new DeviceRegistrationCollision();
      throw new ServiceUnavailableException(
        'Device registration outcome could not be confirmed; retry the same operation',
      );
    } finally {
      if (session) await session.endSession();
    }
  }
}
