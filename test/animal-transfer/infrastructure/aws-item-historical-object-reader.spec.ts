import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { HttpResponse } from '@smithy/protocol-http';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AwsItemHistoricalObjectReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import {
  ItemHistoricalCopyObserver,
  verifyHistoricalObjectBytes,
} from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemStagingCopyPreparer } from '../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';
import {
  transportFixture,
  TransportStep,
} from '../fixtures/s3-promotion-transport.fixture';
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

describe('Fixed source GET through the installed SDK and a synthetic transport', () => {
  const scope = { bucket: target.bucket, expectedBucketOwner: '123456789012' };
  const fixed = { ...revision, versionId: 'v+/=' };
  const fixedRetainUntil = '2027-01-01T00:00:00.000Z';
  const eventHold = 'x-amz-object-lock-event-hold';
  const headers = {
    'content-length': String(fixed.size),
    etag: fixed.etag,
    'x-amz-version-id': fixed.versionId,
    'x-amz-object-lock-mode': 'COMPLIANCE',
    'x-amz-object-lock-retain-until-date': fixedRetainUntil,
    [eventHold]: 'OFF',
  };
  let client: S3Client | undefined;
  afterEach(() => client?.destroy());

  function compose(...steps: TransportStep[]) {
    const transport = transportFixture(steps, { maxAttempts: 1 });
    client = transport.client;
    return {
      ...transport,
      reader: new AwsItemHistoricalObjectReader(client, scope),
    };
  }

  it('sends the exact version, owner and ETag and leaves the original body for streaming', async () => {
    const bytes = Buffer.from('animal-bytes'),
      body = Readable.from([bytes]);
    const f = compose((request) => {
      expect(request.method).toBe('GET');
      expect(request.path).toBe('/historical-key');
      expect(request.query?.versionId).toBe(fixed.versionId);
      expect(request.query?.partNumber).toBeUndefined();
      expect(request.query?.retention).toBeUndefined();
      expect(request.headers.range).toBeUndefined();
      expect(request.headers['if-match']).toBe(fixed.etag);
      expect(request.headers['x-amz-expected-bucket-owner']).toBe(
        scope.expectedBucketOwner,
      );
      return new HttpResponse({ statusCode: 200, headers, body });
    });
    const read = await f.reader.readFixedSource(target, fixed);
    expect(f.sends).toHaveLength(1);
    expect(read).toMatchObject({
      revision: fixed,
      mode: 'COMPLIANCE',
      eventHold: 'OFF',
      fixedRetainUntil,
      expectedBucketOwner: scope.expectedBucketOwner,
    });
    expect(read.body).toBe(body);
    expect(body.readableDidRead).toBe(false);
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of read.body) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(bytes);
    } finally {
      read.close();
    }
    expect(body.destroyed).toBe(true);
  });

  it.each([
    ['verified', 'animal-bytes'],
    ['different digest', 'altered-byte'],
    ['truncated', 'animal'],
  ])(
    'only serializes a historical PUT from isolated bytes when the read is %s',
    async (kind, responseBytes) => {
      const expected = Buffer.from('animal-bytes');
      const expectedDigest = createHash('sha256')
        .update(expected)
        .digest('hex');
      const checksum = Buffer.from(expectedDigest, 'hex').toString('base64');
      const original = Buffer.from(responseBytes);
      const source = Readable.from([
        original.subarray(0, 4),
        original.subarray(4),
      ]);
      const f = compose(
        () => new HttpResponse({ statusCode: 200, headers, body: source }),
        (request) => {
          expect(source.destroyed).toBe(true);
          expect(request.method).toBe('PUT');
          expect(request.path).toBe('/synthetic/isolated-history');
          expect(request.headers).toMatchObject({
            'if-none-match': '*',
            'content-length': String(fixed.size),
            'x-amz-checksum-sha256': checksum,
            'x-amz-expected-bucket-owner': scope.expectedBucketOwner,
          });
          expect(request.headers['x-amz-copy-source']).toBeUndefined();
          expect(request.body).toEqual(expected);
          return new HttpResponse({ statusCode: 200, headers: {} });
        },
      );
      const preparedPut = async () => {
        const read = await f.reader.readFixedSource(target, fixed);
        const chunks: Buffer[] = [];
        // This small synthetic buffer stands in for an isolated artifact.
        const detached = async function* () {
          for await (const chunk of read.body) {
            const copy = Buffer.from(chunk);
            chunks.push(copy);
            yield copy;
          }
        };
        await verifyHistoricalObjectBytes(
          { ...read, body: detached() },
          fixed,
          expectedDigest,
          () => new ConflictError('The synthetic source bytes do not match'),
        );
        original.fill(0);
        return f.client.send(
          new PutObjectCommand({
            Bucket: target.bucket,
            Key: 'synthetic/isolated-history',
            Body: Buffer.concat(chunks),
            ContentLength: fixed.size,
            ChecksumSHA256: checksum,
            ExpectedBucketOwner: scope.expectedBucketOwner,
            IfNoneMatch: '*',
          }),
        );
      };
      if (kind === 'verified') {
        await preparedPut();
        expect(f.sends.map(({ method }) => method)).toEqual(['GET', 'PUT']);
      } else {
        await expect(preparedPut()).rejects.toBeInstanceOf(ConflictError);
        expect(f.sends.map(({ method }) => method)).toEqual(['GET']);
      }
      expect(source.destroyed).toBe(true);
    },
  );

  const encryptionHeader = 'x-amz-server-side-encryption';
  const classHeader = 'x-amz-storage-class';
  const sseS3 = { [encryptionHeader]: 'AES256' };
  it.each([
    [
      'explicit standard',
      { ...sseS3, [classHeader]: 'STANDARD' },
      'SSE_S3',
      'STANDARD',
      false,
    ],
    ['omitted class', sseS3, 'SSE_S3', 'OMITTED', false],
    ['empty class', { ...sseS3, [classHeader]: '' }, 'SSE_S3', 'OTHER', false],
    [
      'unknown class',
      { ...sseS3, [classHeader]: 'private-unknown-class' },
      'SSE_S3',
      'OTHER',
      false,
    ],
    [
      'restored archive',
      {
        ...sseS3,
        [classHeader]: 'GLACIER',
        'x-amz-restore': 'private-restore-details',
      },
      'SSE_S3',
      'OTHER',
      true,
    ],
    [
      'archive signal',
      {
        ...sseS3,
        [classHeader]: 'STANDARD',
        'x-amz-archive-status': 'ARCHIVE_ACCESS',
      },
      'SSE_S3',
      'STANDARD',
      true,
    ],
    [
      'KMS',
      {
        [encryptionHeader]: 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': 'private-kms-key',
      },
      'SSE_KMS',
      'OMITTED',
      false,
    ],
    [
      'dual-layer KMS',
      { [encryptionHeader]: 'aws:kms:dsse' },
      'SSE_KMS',
      'OMITTED',
      false,
    ],
    [
      'SSE-C',
      {
        'x-amz-server-side-encryption-customer-algorithm': 'AES256',
        'x-amz-server-side-encryption-customer-key-md5': 'private-key-md5',
      },
      'SSE_C',
      'OMITTED',
      false,
    ],
    ['missing encryption', {}, 'UNKNOWN', 'OMITTED', false],
    [
      'ambiguous encryption',
      { [encryptionHeader]: 'AES256, aws:kms' },
      'UNKNOWN',
      'OMITTED',
      false,
    ],
    [
      'contradictory KMS signal',
      { ...sseS3, 'x-amz-server-side-encryption-bucket-key-enabled': 'false' },
      'UNKNOWN',
      'OMITTED',
      false,
    ],
    [
      'contradictory customer signal',
      {
        ...sseS3,
        'x-amz-server-side-encryption-customer-key-md5': 'private-key-md5',
      },
      'UNKNOWN',
      'OMITTED',
      false,
    ],
  ] as const)(
    'captures bounded storage facts for %s without consuming the stream',
    async (
      _kind,
      received,
      encryption,
      storageClass,
      restoreOrArchiveReported,
    ) => {
      const body = Readable.from([Buffer.from('animal-bytes')]);
      const f = compose(
        () =>
          new HttpResponse({
            statusCode: 200,
            headers: { ...headers, ...received },
            body,
          }),
      );
      const read = await f.reader.readFixedSource(target, fixed);
      try {
        expect(read.storage).toEqual({
          encryption,
          storageClass,
          restoreOrArchiveReported,
        });
        expect(Object.isFrozen(read.storage)).toBe(true);
        expect(body.readableDidRead).toBe(false);
        expect(f.sends).toHaveLength(1);
      } finally {
        read.close();
      }
      expect(body.destroyed).toBe(true);
    },
  );

  it.each([
    ['active hold', 200, { [eventHold]: 'ON' }],
    ['missing hold', 200, { [eventHold]: undefined }],
    ['unexpected hold', 200, { [eventHold]: 'OFF, ON' }],
    ['duration with hold off', 200, { [eventHold + '-duration-days']: '3' }],
    ['wrong mode', 200, { 'x-amz-object-lock-mode': 'GOVERNANCE' }],
    ['missing date', 200, { 'x-amz-object-lock-retain-until-date': undefined }],
    ['other version', 200, { 'x-amz-version-id': 'other-version' }],
    ['missing version', 200, { 'x-amz-version-id': undefined }],
    ['wrong ETag', 200, { etag: 'other-etag' }],
    ['wrong size', 200, { 'content-length': '11' }],
    ['delete marker', 200, { 'x-amz-delete-marker': 'true' }],
    ['partial status', 206, {}],
    ['content range', 200, { 'content-range': 'bytes 0-11/12' }],
    ['part response', 200, { 'x-amz-mp-parts-count': '2' }],
  ] as const)(
    'rejects %s and destroys the returned body',
    async (_kind, statusCode, changes) => {
      const received = Object.fromEntries(
        Object.entries({ ...headers, ...changes }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const body = Readable.from([Buffer.from('animal-bytes')]);
      const f = compose(
        () => new HttpResponse({ statusCode, headers: received, body }),
      );
      await expect(
        f.reader.readFixedSource(target, fixed),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(body.destroyed).toBe(true);
      expect(f.sends).toHaveLength(1);
    },
  );

  it('keeps command middleware isolated when the shared client caches other GET handlers', async () => {
    const response = (state: string) =>
      new HttpResponse({
        statusCode: 200,
        headers: { ...headers, [eventHold]: state },
        body: Readable.from([Buffer.from('animal-bytes')]),
      });
    const f = compose(
      () => response('ON'),
      () => response('OFF'),
      () => response('ON'),
    );
    f.client.config.cacheMiddleware = true;
    (await f.reader.read(target, fixed)).close();
    (await f.reader.readFixedSource(target, fixed)).close();
    await expect(
      f.reader.readFixedSource(target, fixed),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(f.sends.map((request) => request.method)).toEqual([
      'GET',
      'GET',
      'GET',
    ]);
  });

  it('requires the configured bucket and an explicit version before invoking the SDK', async () => {
    const f = compose();
    await expect(
      f.reader.readFixedSource({ ...target, bucket: 'other-bucket' }, fixed),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.reader.readFixedSource(target, { ...fixed, versionId: 'null' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(f.sends).toEqual([]);
  });

  it('closes the body and sanitizes a deserialization failure before the SDK returns it', async () => {
    const body = Readable.from([Buffer.from('animal-bytes')]);
    const f = compose(
      () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            ...headers,
            'x-amz-object-lock-retain-until-date': 'private malformed date',
          },
          body,
        }),
    );
    const error: unknown = await f.reader
      .readFixedSource(target, fixed)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect(String(error)).not.toContain('private malformed date');
    expect(body.destroyed).toBe(true);
    expect(f.sends).toHaveLength(1);
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
