import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AwsItemHistoricalObjectReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemStagingCopyPreparer } from '../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { captureItemArchiveFileDefinition } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';

const target = { bucket: 'test-bucket', key: 'historical-key' };
const revision = {
  etag: 'historical-etag',
  size: 12,
  versionId: 'historical-v1',
};

describe('AWS source retention metadata with an explicit fake client', () => {
  const scope = { bucket: target.bucket, expectedBucketOwner: '123456789012' };
  const requested = { ...target, versionId: 'v+/=' };
  const reported = '2027-01-01T00:00:00.000Z';

  it('reads the configured owner and exact opaque version with only GetObjectRetention', async () => {
    const configured = { ...scope };
    const send = jest.fn((command: GetObjectRetentionCommand) => {
      if (!(command instanceof GetObjectRetentionCommand))
        throw new Error('Unexpected source retention command');
      return Promise.resolve({
        $metadata: { httpStatusCode: 200 },
        Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(reported) },
      });
    });
    const reader = new AwsItemHistoricalObjectReader(
      { send } as never,
      configured,
    );
    configured.expectedBucketOwner = '000000000000';
    const result = await reader.readSourceRetention(requested);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectRetentionCommand);
    expect(command.input).toEqual({
      Bucket: target.bucket,
      Key: target.key,
      VersionId: requested.versionId,
      ExpectedBucketOwner: scope.expectedBucketOwner,
    });
    expect(result).toEqual({
      expectedBucketOwner: scope.expectedBucketOwner,
      mode: 'COMPLIANCE',
      reportedRetainUntil: reported,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([undefined, 'null', ' ', 'é'.repeat(513)])(
    'rejects a missing, null or invalid version before sending',
    async (versionId) => {
      const send = jest.fn();
      const reader = new AwsItemHistoricalObjectReader(
        { send } as never,
        scope,
      );
      await expect(
        reader.readSourceRetention({ ...requested, versionId } as never),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { ...scope, bucket: 'other-bucket' },
    { ...scope, expectedBucketOwner: 'invalid' },
  ])(
    'requires explicit matching bucket and owner configuration',
    async (configured) => {
      const send = jest.fn();
      const reader = new AwsItemHistoricalObjectReader(
        { send } as never,
        configured,
      );
      await expect(
        reader.readSourceRetention(requested),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { Mode: 'GOVERNANCE', RetainUntilDate: new Date(reported) },
    { Mode: 'COMPLIANCE' },
    { Mode: 'COMPLIANCE', RetainUntilDate: new Date(NaN) },
  ])('rejects missing or unsupported retention metadata', async (Retention) => {
    const send = jest
      .fn()
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Retention });
    const reader = new AwsItemHistoricalObjectReader({ send } as never, scope);
    await expect(reader.readSourceRetention(requested)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, undefined])(
    'sanitizes a provider error %s and does not substitute another version',
    async (status) => {
      const send = jest.fn().mockRejectedValue({
        message: 'private endpoint token',
        $metadata: { httpStatusCode: status },
      });
      const reader = new AwsItemHistoricalObjectReader(
        { send } as never,
        scope,
      );
      const error: unknown = await reader
        .readSourceRetention(requested)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(String(error)).not.toMatch(/private|token|endpoint/);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('requires a recognized successful response even when the retention payload looks valid', async () => {
    const send = jest.fn().mockResolvedValue({
      Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(reported) },
    });
    const reader = new AwsItemHistoricalObjectReader({ send } as never, scope);
    await expect(reader.readSourceRetention(requested)).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('AWS historical object reader with an explicitly supplied fake client, no sockets', () => {
  it.each([true, false])(
    'observes staging with its own conditional HEAD/GET pins (versioned=%s)',
    async (versioned) => {
      const f = await historicalCopyPreparationFixture(),
        bytes = Buffer.from('animal-bytes');
      f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
      await f.service.prepareHistoricalCopy(f.input);
      const commands: Array<HeadObjectCommand | GetObjectCommand> = [],
        bodies: Readable[] = [];
      const reader = new AwsItemHistoricalObjectReader({
        send: jest.fn((command: HeadObjectCommand | GetObjectCommand) => {
          commands.push(command);
          const staging =
            command.input.Key === f.state.db.files[0].recipientStagingKey;
          const headers = {
            ETag: staging ? 'staging-etag' : 'history-etag',
            ContentLength: bytes.byteLength,
            VersionId: staging
              ? versioned
                ? 'staging-v1'
                : undefined
              : 'history-v1',
          };
          if (command instanceof HeadObjectCommand)
            return Promise.resolve(headers);
          if (command instanceof GetObjectCommand) {
            const body = Readable.from([bytes]);
            bodies.push(body);
            return Promise.resolve({ ...headers, Body: body });
          }
          throw new Error('Unexpected write command');
        }),
      } as never);
      const observer = new ItemHistoricalCopyObserver(f.store, reader);
      await new ItemStagingCopyPreparer(f.store, observer).prepare(f.input);
      commands.length = 0;
      bodies.length = 0;
      const result = await observer.observeStaging(f.input);
      expect(commands.map((c) => c.constructor.name)).toEqual([
        'HeadObjectCommand',
        'GetObjectCommand',
        'HeadObjectCommand',
      ]);
      expect(
        commands.every(
          (c) =>
            c.input.Bucket === f.input.bucket &&
            c.input.Key === f.state.db.files[0].recipientStagingKey,
        ),
      ).toBe(true);
      expect(commands[1].input).toMatchObject({
        IfMatch: 'staging-etag',
        VersionId: versioned ? 'staging-v1' : undefined,
      });
      expect(commands[0].input).not.toHaveProperty('VersionId');
      expect(commands[2].input).not.toHaveProperty('VersionId');
      expect(result).toMatchObject({
        protocol: 'ITEM_STAGING_BYTE_OBSERVATION_V1',
        bytes: 'MATCH',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(bodies[0].destroyed).toBe(true);
    },
  );
  it.each([true, false])(
    'reuses HEAD/GET only for the original manifest source pin (versioned=%s)',
    async (versioned) => {
      const f = await historicalCopyPreparationFixture(),
        bytes = Buffer.from('animal-bytes');
      const file = f.state.db.files[0] as unknown as ArchiveFile;
      const archive = f.state.db.archives.find(
        (a) => a.id === file.archiveId,
      )! as unknown as OwnershipArchive;
      const definition = captureItemArchiveFileDefinition(archive, file);
      const original = {
        etag: file.source.etag,
        size: file.source.size,
        ...(versioned ? { versionId: file.source.versionId } : {}),
      };
      file.source = original;
      file.definitionHash = archiveHash({ ...definition, source: original });
      f.input.expectedFileDefinitionHash = file.definitionHash;
      f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
      await f.service.prepareHistoricalCopy(f.input);
      const body = Readable.from([bytes]),
        commands: Array<HeadObjectCommand | GetObjectCommand> = [];
      const headers = {
        ETag: original.etag,
        ContentLength: original.size,
        VersionId: original.versionId,
      };
      const reader = new AwsItemHistoricalObjectReader({
        send: jest.fn((command: HeadObjectCommand | GetObjectCommand) => {
          commands.push(command);
          if (command instanceof HeadObjectCommand)
            return Promise.resolve(headers);
          if (command instanceof GetObjectCommand)
            return Promise.resolve({ ...headers, Body: body });
          throw new Error('Unexpected write command');
        }),
      } as never);
      const result = await new ItemHistoricalCopyObserver(
        f.store,
        reader,
      ).observeSource(f.input);
      expect(commands.map((c) => c.constructor.name)).toEqual([
        'HeadObjectCommand',
        'GetObjectCommand',
        'HeadObjectCommand',
      ]);
      expect(
        commands.every(
          (c) =>
            c.input.Bucket === f.input.bucket && c.input.Key === file.sourceKey,
        ),
      ).toBe(true);
      expect(commands[1].input).toMatchObject({
        IfMatch: original.etag,
        VersionId: original.versionId,
      });
      expect(result).toMatchObject({
        protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
        bytes: 'MATCH',
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(body.destroyed).toBe(true);
    },
  );
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
