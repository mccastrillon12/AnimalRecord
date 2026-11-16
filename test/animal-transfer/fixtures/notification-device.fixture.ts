import { ServiceUnavailableException } from '@nestjs/common';
import { NotificationDevices } from '../../../src/context/notification/application/notification-devices';
import {
  DeviceRecord,
  DeviceRegistrationCollision,
  NotificationDeviceStore,
} from '../../../src/context/notification/domain/notification-device';
import { promotionTestId as id } from './media-promotion.fixture';
import { otpActor, otpOther } from './transfer-otp.fixture';

export const installationKey = Buffer.alloc(32, 7).toString('base64url');
export function notificationDeviceFixture() {
  let rows = new Map<string, DeviceRecord>();
  let claims = new Map<string, { installationId: string; revision: number }>();
  let queue = Promise.resolve(),
    sequence = 100;
  const flags = { lostReply: false, failClaim: false, readFailure: false };
  const copy = <T>(v: T): T => structuredClone(v);
  const find = jest.fn<Promise<DeviceRecord | null>, [string]>(
    (installation) =>
      flags.readFailure
        ? Promise.reject(
            new ServiceUnavailableException(
              'Device registration could not be loaded',
            ),
          )
        : Promise.resolve(copy(rows.get(installation) ?? null)),
  );
  const store: NotificationDeviceStore = {
    find,
    async change(installation, transition) {
      let release!: () => void;
      const prior = queue;
      queue = new Promise<void>((r) => {
        release = r;
      });
      await prior;
      const beforeRows = copy(rows),
        beforeClaims = copy(claims);
      let next: DeviceRecord;
      try {
        const current = copy(rows.get(installation) ?? null);
        next = transition(current);
        if (next !== current) {
          rows.set(installation, copy(next));
          if (current?.state === 'ACTIVE') {
            const assigned = claims.get(current.tokenHash!);
            if (
              assigned?.installationId !== installation ||
              assigned.revision !== current.revision
            )
              throw new Error('Simulated token assignment mismatch');
            claims.delete(current.tokenHash!);
          }
          if (next.state === 'ACTIVE') {
            if (claims.has(next.tokenHash!))
              throw new DeviceRegistrationCollision();
            claims.set(next.tokenHash!, {
              installationId: installation,
              revision: next.revision,
            });
          }
          if (flags.failClaim)
            throw new ServiceUnavailableException(
              'Simulated token claim write failed',
            );
        }
      } catch (error) {
        rows = beforeRows;
        claims = beforeClaims;
        release();
        throw error;
      }
      release();
      if (flags.lostReply) {
        flags.lostReply = false;
        throw new ServiceUnavailableException(
          'Simulated reply lost after commit',
        );
      }
      return copy(next);
    },
  };
  const service = new NotificationDevices(store);
  const installationId = id(10),
    token = 'synthetic-push-token-A';
  const nextOperation = () => id(sequence++);
  const register = (
    actor = otpActor,
    installation = installationId,
    revision = 0,
    pushToken = token,
    operation = nextOperation(),
    key = installationKey,
  ) =>
    service.register(actor, installation, key, operation, `"${revision}"`, {
      provider: 'FCM',
      platform: 'ANDROID',
      token: pushToken,
    });
  return {
    service,
    store,
    find,
    flags,
    id,
    installationId,
    key: installationKey,
    token,
    nextOperation,
    register,
    otherActor: otpOther,
    rows: () => rows,
    claims: () => claims,
    snapshot: () => ({
      rows: copy([...rows.entries()]),
      claims: copy([...claims.entries()]),
    }),
  };
}
