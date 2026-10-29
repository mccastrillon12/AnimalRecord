import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  DeviceRecord,
  DeviceRegistration,
  DeviceRegistrationCollision,
  DeviceResponse,
  NotificationDeviceStore,
} from '../domain/notification-device';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const invalid = () =>
  new InvalidArgumentError('Invalid device registration headers or body');
const missing = () =>
  new ResourceNotFoundError('Device installation not found');
const hex = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function assertRecord(row: DeviceRecord, installationId: string): void {
  if (
    row._id !== installationId ||
    !hex(row.keyHash) ||
    !isUuid(row.userId) ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !['ACTIVE', 'DISABLED'].includes(row.state) ||
    row.provider !== 'FCM' ||
    !['ANDROID', 'IOS'].includes(row.platform) ||
    !isUuid(row.lastOperationId) ||
    !hex(row.lastOperationHash) ||
    typeof row.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.updatedAt)) ||
    new Date(row.updatedAt).toISOString() !== row.updatedAt ||
    (row.state === 'ACTIVE'
      ? typeof row.token !== 'string' ||
        !hex(row.tokenHash) ||
        hash(row.token) !== row.tokenHash
      : row.token !== undefined || row.tokenHash !== undefined)
  )
    throw new ServiceUnavailableException(
      'Device registration data could not be verified',
    );
}
const publicState = (row: DeviceRecord, actorId: string): DeviceResponse => ({
  installationId: row._id,
  revision: row.revision,
  state: row.state,
  registeredToCurrentUser: row.state === 'ACTIVE' && row.userId === actorId,
  provider: row.provider,
  platform: row.platform,
  updatedAt: row.updatedAt,
});
@Injectable()
export class NotificationDevices {
  constructor(
    @Inject('NotificationDeviceStore')
    private readonly store: NotificationDeviceStore,
  ) {}
  private binding(actorId: string, installationId: string, key: string) {
    if (
      !isUuid(actorId) ||
      !isUuid(installationId) ||
      typeof key !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(key) ||
      Buffer.from(key, 'base64url').length !== 32 ||
      Buffer.from(key, 'base64url').toString('base64url') !== key
    )
      throw invalid();
    return hash(`ANIMAL_RECORD_INSTALLATION_V1\0${installationId}\0${key}`);
  }
  private authenticate(
    row: DeviceRecord,
    installationId: string,
    keyHash: string,
  ) {
    assertRecord(row, installationId);
    if (row.keyHash !== keyHash) throw missing();
  }
  async get(
    actorId: string,
    installationId: string,
    key: string,
  ): Promise<DeviceResponse> {
    const keyHash = this.binding(actorId, installationId, key),
      row = await this.store.find(installationId);
    if (!row) throw missing();
    this.authenticate(row, installationId, keyHash);
    return publicState(row, actorId);
  }
  async register(
    actorId: string,
    installationId: string,
    key: string,
    operationId: string,
    ifMatch: string,
    raw: DeviceRegistration,
  ): Promise<DeviceResponse> {
    if (
      !raw ||
      Object.keys(raw).sort().join(',') !== 'platform,provider,token' ||
      raw.provider !== 'FCM' ||
      !['ANDROID', 'IOS'].includes(raw.platform) ||
      typeof raw.token !== 'string' ||
      !raw.token ||
      Buffer.byteLength(raw.token, 'utf8') > 4096 ||
      /\s/.test(raw.token) ||
      [...raw.token].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      throw invalid();
    return this.mutate(
      actorId,
      installationId,
      key,
      operationId,
      ifMatch,
      Object.freeze({ ...raw }),
    );
  }
  async unregister(
    actorId: string,
    installationId: string,
    key: string,
    operationId: string,
    ifMatch: string,
  ): Promise<DeviceResponse> {
    return this.mutate(actorId, installationId, key, operationId, ifMatch);
  }
  private async mutate(
    actorId: string,
    installationId: string,
    key: string,
    operationId: string,
    ifMatch: string,
    input?: Readonly<DeviceRegistration>,
  ): Promise<DeviceResponse> {
    const keyHash = this.binding(actorId, installationId, key);
    if (
      !isUuid(operationId) ||
      typeof ifMatch !== 'string' ||
      !/^"(0|[1-9]\d{0,15})"$/.test(ifMatch)
    )
      throw invalid();
    const expected = Number(ifMatch.slice(1, -1));
    if (!Number.isSafeInteger(expected) || expected >= Number.MAX_SAFE_INTEGER)
      throw invalid();
    const tokenHash = input ? hash(input.token) : undefined;
    const operationHash = hash(
      JSON.stringify({
        actorId,
        installationId,
        expected,
        action: input ? 'REGISTER' : 'UNREGISTER',
        ...(input
          ? { provider: input.provider, platform: input.platform, tokenHash }
          : {}),
      }),
    );
    const transition = (current: DeviceRecord | null): DeviceRecord => {
      if (current) {
        this.authenticate(current, installationId, keyHash);
        if (current.lastOperationId === operationId) {
          if (
            current.userId !== actorId ||
            current.lastOperationHash !== operationHash
          )
            throw new ConflictError(
              'Device Idempotency-Key was already used for another operation',
            );
          return current;
        }
        if (!input && current.userId !== actorId) throw missing();
        if (current.revision !== expected)
          throw new ConflictError(
            'Device revision changed; refresh this installation before retrying',
          );
      } else if (!input) throw missing();
      else if (expected !== 0)
        throw new ConflictError(
          'New device installations require If-Match revision zero',
        );
      return {
        _id: installationId,
        keyHash,
        userId: actorId,
        revision: expected + 1,
        state: input ? 'ACTIVE' : 'DISABLED',
        provider: 'FCM',
        platform: input?.platform ?? current!.platform,
        ...(input ? { token: input.token, tokenHash } : {}),
        updatedAt: new Date().toISOString(),
        lastOperationId: operationId,
        lastOperationHash: operationHash,
      };
    };
    try {
      const row = await this.store.change(installationId, transition);
      this.authenticate(row, installationId, keyHash);
      if (
        row.lastOperationId !== operationId ||
        row.lastOperationHash !== operationHash ||
        row.userId !== actorId
      )
        throw new ServiceUnavailableException(
          'Device registration acknowledgement did not match the operation',
        );
      return publicState(row, actorId);
    } catch (error) {
      if (error instanceof DeviceRegistrationCollision) {
        // Resolve only known uniqueness contention with the exact persisted receipt.
        // Never adopt a write after an unknown commit/network error here.
        const row = await this.store.find(installationId);
        if (
          row &&
          row.keyHash === keyHash &&
          row.userId === actorId &&
          row.lastOperationId === operationId &&
          row.lastOperationHash === operationHash
        ) {
          this.authenticate(row, installationId, keyHash);
          return publicState(row, actorId);
        }
      }
      throw error;
    }
  }
}
