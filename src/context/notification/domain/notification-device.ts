import { ConflictError } from '../../shared/domain/errors/ConflictError';
export type DevicePlatform = 'ANDROID' | 'IOS';
export type DeviceRecord = {
  _id: string;
  keyHash: string;
  userId: string;
  revision: number;
  state: 'ACTIVE' | 'DISABLED';
  provider: 'FCM';
  platform: DevicePlatform;
  token?: string;
  tokenHash?: string;
  updatedAt: string;
  lastOperationId: string;
  lastOperationHash: string;
};
export type DeviceRegistration = {
  provider: 'FCM';
  platform: DevicePlatform;
  token: string;
};
export type DeviceResponse = {
  installationId: string;
  revision: number;
  state: DeviceRecord['state'];
  registeredToCurrentUser: boolean;
  provider: 'FCM';
  platform: DevicePlatform;
  updatedAt: string;
};
export class DeviceRegistrationCollision extends ConflictError {
  constructor() {
    super(
      'Device registration changed or the token is already assigned; refresh this installation before retrying',
    );
  }
}
export interface NotificationDeviceStore {
  find(installationId: string): Promise<DeviceRecord | null>;
  change(
    installationId: string,
    transition: (current: DeviceRecord | null) => DeviceRecord,
  ): Promise<DeviceRecord>;
}
