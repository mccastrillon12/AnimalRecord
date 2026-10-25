import { toUserResponse } from '../../../src/app/user/user-response.mapper';
import { User } from '../../../src/context/user/domain/user';

it('keeps public profile/identification fields while omitting all authentication secrets', () => {
  const user = User.fromPrimitives({
    id: '123e4567-e89b-42d3-a456-426614174001',
    name: 'Ana',
    identificationType: 'CC',
    identificationNumber: '123456',
    country: 'CO',
    email: 'ana@example.com',
    authMethod: 'EMAIL',
    isVerified: true,
    isBiometricEnabled: false,
    password: 'password-hash',
    refreshToken: 'refresh-hash',
    pin: 'pin-hash',
    verificationCode: 'otp-hash',
    resetPasswordCode: 'reset-token',
    resetPinCode: 'reset-pin-token',
  });
  const response = toUserResponse(user);
  expect(response).toEqual(
    expect.objectContaining({
      name: 'Ana',
      identificationNumber: '123456',
      countryId: 'CO',
      country: 'CO',
    }),
  );
  for (const key of [
    'password',
    'refreshToken',
    'pin',
    'verificationCode',
    'resetPasswordCode',
    'resetPinCode',
  ]) {
    expect(response).not.toHaveProperty(key);
  }
});
