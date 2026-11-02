import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AwsItemHistoricalObjectReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

const target = { bucket: 'test-bucket', key: 'historical-key' };
const revision = {
  etag: 'historical-etag',
  size: 12,
  versionId: 'historical-v1',
};

describe('AWS historical object reader with an explicitly supplied fake client, no sockets', () => {
  it.each([true, false])(
    'binds the observer to historical HEAD/GET/HEAD with conditional reads (versioned=%s)',
    async (versioned) => {
      const f = await historicalCopyPreparationFixture();
      const bytes = Buffer.from('animal-bytes');
      f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
      await f.service.prepareHistoricalCopy(f.input);
      const body = Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]);
      const headers = {
        ETag: revision.etag,
        ContentLength: bytes.byteLength,
        VersionId: versioned ? revision.versionId : undefined,
      };
      const commands: Array<HeadObjectCommand | GetObjectCommand> = [];
      const client = {
        send: jest.fn((command: HeadObjectCommand | GetObjectCommand) => {
          commands.push(command);
          if (command instanceof HeadObjectCommand)
            return Promise.resolve(headers);
          if (command instanceof GetObjectCommand)
            return Promise.resolve({ ...headers, Body: body });
          throw new Error('A historical reader cannot send write operations');
        }),
      };
      const reader = new AwsItemHistoricalObjectReader(client as never);
      const result = await new ItemHistoricalCopyObserver(
        f.store,
        reader,
      ).observe(f.input);
      expect(commands.map((c) => c.constructor.name)).toEqual([
        'HeadObjectCommand',
        'GetObjectCommand',
        'HeadObjectCommand',
      ]);
      for (const command of commands)
        expect(command.input).toMatchObject({
          Bucket: f.input.bucket,
          Key: f.state.db.files[0].historicalKey,
        });
      expect(commands[0].input).not.toHaveProperty('VersionId');
      expect(commands[2].input).not.toHaveProperty('VersionId');
      expect(commands[1].input).toMatchObject({
        IfMatch: revision.etag,
        VersionId: versioned ? revision.versionId : undefined,
      });
      expect(result.bytes).toBe('MATCH');
      expect(result.copyDispatch).toBe('NOT_AUTHORIZED');
      expect(body.destroyed).toBe(true);
    },
  );
  it('maps only a HEAD 404 to absence', async () => {
    const reader = new AwsItemHistoricalObjectReader({
      send: jest.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } }),
    } as never);
    expect(await reader.head(target)).toBeNull();
  });
  it.each([403, 500, undefined])(
    'sanitizes a HEAD %s without reporting false absence',
    async (status) => {
      const reader = new AwsItemHistoricalObjectReader({
        send: jest.fn().mockRejectedValue({
          message: 'private endpoint token',
          $metadata: { httpStatusCode: status },
        }),
      } as never);
      const error: unknown = await reader.head(target).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(String(error)).not.toMatch(/private|token|endpoint/);
    },
  );
  it.each([404, 412, 403, 500, undefined])(
    'handles a failed conditional GET %s without fallback or retry',
    async (status) => {
      const send = jest.fn().mockRejectedValue({
        message: 'private endpoint token',
        $metadata: { httpStatusCode: status },
      });
      const reader = new AwsItemHistoricalObjectReader({ send } as never);
      const error: unknown = await reader
        .read(target, revision)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        [404, 412].includes(status ?? 0) ? ConflictError : ExternalServiceError,
      );
      expect(String(error)).not.toMatch(/private|token|endpoint/);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects an unsupported body instead of interpreting it as verified bytes', async () => {
    const reader = new AwsItemHistoricalObjectReader({
      send: jest.fn().mockResolvedValue({ Body: Buffer.from('bytes') }),
    } as never);
    await expect(reader.read(target, revision)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
  it('does not observe a delete marker and closes a returned Node stream', async () => {
    const body = Readable.from([Buffer.from('bytes')]);
    const reader = new AwsItemHistoricalObjectReader({
      send: jest.fn().mockResolvedValue({ DeleteMarker: true, Body: body }),
    } as never);
    expect(await reader.head(target)).toBeNull();
    await expect(reader.read(target, revision)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(body.destroyed).toBe(true);
  });
});
