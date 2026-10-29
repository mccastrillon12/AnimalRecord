import { ArgumentsHost } from '@nestjs/common';
import { MediaPromotionConfirmationError } from '../../../src/context/animal-media/application/media-promotion-confirmation';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';

describe('Promotion confirmation HTTP errors, without connecting callers', () => {
  it.each([
    [
      'VERIFY',
      'CONFLICT',
      409,
      'The media confirmation changed; refresh before confirming',
    ],
    ['SEAL', 'UNCERTAIN', 500, 'The media confirmation outcome is uncertain'],
    [
      'DISPATCH',
      'UNCERTAIN',
      500,
      'The media confirmation outcome is uncertain',
    ],
    [
      'INSPECT',
      'UNAVAILABLE',
      502,
      'The media destination could not be verified',
    ],
    [
      'VERIFY',
      'UNAVAILABLE',
      502,
      'The media destination could not be verified',
    ],
    ['READ', 'UNAVAILABLE', 500, 'Internal server error'],
    ['OPEN', 'UNAVAILABLE', 500, 'Internal server error'],
    ['DISPATCH_SETUP', 'UNAVAILABLE', 500, 'Internal server error'],
  ] as const)(
    'maps %s/%s to %s with the existing envelope and no internal data',
    (stage, reason, statusCode, message) => {
      const json = jest.fn<void, [Record<string, unknown>]>(),
        status = jest.fn().mockReturnValue({ json });
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status }),
          getRequest: () => ({ url: '/synthetic-confirmation' }),
        }),
      } as unknown as ArgumentsHost;
      const error = Object.assign(
        new MediaPromotionConfirmationError(stage, reason),
        {
          message: 'secret URL credentials payload',
          cause: new Error('secret raw cause'),
          $metadata: { httpStatusCode: 200 },
          observationId: 'internal-id',
        },
      );
      const log = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        new HttpExceptionFilter().catch(error, host);
        expect(status).toHaveBeenCalledWith(statusCode);
        expect(json).toHaveBeenCalledTimes(1);
        const body = json.mock.calls[0][0];
        expect(Object.keys(body).sort()).toEqual([
          'message',
          'path',
          'statusCode',
          'timestamp',
        ]);
        expect(body).toMatchObject({
          statusCode,
          message,
          path: '/synthetic-confirmation',
        });
        expect(Number.isFinite(Date.parse(body.timestamp as string))).toBe(
          true,
        );
        expect(JSON.stringify(body)).not.toMatch(
          /secret|credentials|payload|internal-id|cause|stage|reason/,
        );
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );
});
