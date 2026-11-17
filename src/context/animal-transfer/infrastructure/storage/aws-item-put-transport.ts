import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../domain/ownership-archive';
import type {
  ItemPutTransport,
  ItemPutTransportRequest,
} from '../../domain/transfer-item-historical-put-transport';

type Configuration = Readonly<{
  region: string;
  bucket: string;
  expectedBucketOwner: string;
  credentials: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
  timeoutMs: number;
  complianceRetainUntil?: string;
}>;

const invalidRequest = () =>
  new ConflictError('The signed archive PUT differs from the prepared request');
const invalidBody = () =>
  new ConflictError(
    'The archive PUT body differs from its prepared length or checksum',
  );
const failedSend = () =>
  new ExternalServiceError('The prepared archive PUT did not return success');
function isFutureRetention(value: string): boolean {
  const date = new Date(value);
  return (
    typeof value === 'string' &&
    date.getTime() > Date.now() &&
    date.toISOString() === value
  );
}
export const ITEM_PUT_AUDIT_METADATA = 'animalrecord-put-audit';
const allowedSdkHeaders = [
  'authorization',
  'x-amz-date',
  'x-amz-security-token',
  'amz-sdk-invocation-id',
  'amz-sdk-request',
  'x-amz-user-agent',
  'user-agent',
  'expect',
];

async function* verifiedBody(
  body: AsyncIterable<Uint8Array>,
  length: number,
  checksum: string,
) {
  const digest = createHash('sha256');
  let remaining = length;
  let lastByte = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > remaining)
      throw invalidBody();
    if (!chunk.byteLength) continue;
    const bytes = Buffer.from(chunk);
    remaining -= bytes.length;
    digest.update(bytes);
    if (remaining > 0) yield bytes;
    else {
      lastByte = bytes[bytes.length - 1];
      if (bytes.length > 1) yield bytes.subarray(0, -1);
    }
  }
  if (remaining !== 0 || digest.digest('base64') !== checksum)
    throw invalidBody();
  yield Buffer.of(lastByte);
}

/** Explicit composition for regional AWS S3. The SDK signs locally and the Node handler owns the physical send. */
export class AwsItemPutTransport implements ItemPutTransport {
  private readonly config: Configuration;

  constructor(config: Configuration) {
    if (
      !/^(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d+$/.test(config.region) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^\d{12}$/.test(config.expectedBucketOwner) ||
      !config.credentials?.accessKeyId ||
      !config.credentials.secretAccessKey ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 2_147_483_647
    )
      throw new ConflictError('The archive PUT transport is not configured');
    if (
      config.complianceRetainUntil !== undefined &&
      !isFutureRetention(config.complianceRetainUntil)
    )
      throw new ConflictError(
        'The archive PUT retention date must be a future UTC timestamp',
      );
    this.config = Object.freeze({
      ...config,
      credentials: Object.freeze({ ...config.credentials }),
    });
  }

  assertRetentionThrough(requiredThrough: string) {
    const retainUntil = this.config.complianceRetainUntil;
    if (
      !retainUntil ||
      !isFutureRetention(retainUntil) ||
      !(Date.parse(retainUntil) > Date.parse(requiredThrough))
    )
      throw new ConflictError(
        'The archive PUT retention date does not cover the required horizon',
      );
  }

  async prepare(
    raw: ItemPutTransportRequest,
    options?: Readonly<{ correlateAudit: true }>,
  ) {
    const request = Object.freeze({ ...raw });
    const { key, contentLength, checksumSHA256 } = request;
    const retainUntil = this.config.complianceRetainUntil;
    if (retainUntil !== undefined && !isFutureRetention(retainUntil))
      throw new ConflictError(
        'The archive PUT retention date is no longer valid',
      );
    if (
      request.method !== 'PUT' ||
      request.bucket !== this.config.bucket ||
      request.expectedBucketOwner !== this.config.expectedBucketOwner ||
      request.ifNoneMatch !== '*' ||
      request.cacheControl !== 'private, no-store' ||
      typeof key !== 'string' ||
      Buffer.byteLength(key) > 1024 ||
      key.includes('\\') ||
      [...key].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      key
        .split('/')
        .some((segment) => !segment || segment === '.' || segment === '..') ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      typeof checksumSHA256 !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(checksumSHA256) ||
      Buffer.from(checksumSHA256, 'base64').toString('base64') !==
        checksumSHA256 ||
      typeof request.contentType !== 'string' ||
      !request.contentType
    )
      throw invalidRequest();

    const payloadHash = Buffer.from(checksumSHA256, 'base64').toString('hex');
    const auditMarker = options ? randomBytes(32).toString('hex') : undefined;
    const wire = await this.sign(request, payloadHash, auditMarker);
    const serializedRequestHash = archiveHash(wire);
    let sent = false;
    return Object.freeze({
      request,
      serializedRequestHash,
      ...(auditMarker === undefined
        ? {}
        : { auditMarkerHash: archiveHash(auditMarker) }),
      sendOnce: async (body: AsyncIterable<Uint8Array>): Promise<void> => {
        if (sent)
          throw new ConflictError(
            'The prepared archive PUT has already been delegated',
          );
        sent = true;
        const controller = new AbortController();
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(this.config.timeoutMs),
        ]);
        const stream = Readable.from(
          verifiedBody(body, contentLength, checksumSHA256),
          { objectMode: false },
        );
        stream.on('error', () => controller.abort());
        const transport = new NodeHttpHandler();
        try {
          const message = HttpRequest.clone(wire);
          message.body = stream;
          const { response } = await transport.handle(message, {
            abortSignal: signal,
          });
          if (response.body instanceof Readable) response.body.destroy();
          if (
            response.statusCode !== 200 ||
            !stream.readableEnded ||
            signal.aborted
          )
            throw failedSend();
        } catch {
          throw failedSend();
        } finally {
          stream.destroy();
          transport.destroy();
        }
      },
    });
  }

  private async sign(
    request: ItemPutTransportRequest,
    payloadHash: string,
    auditMarker?: string,
  ) {
    const { region, credentials } = this.config;
    const hostname = `s3.${region}.amazonaws.com`;
    const body = Readable.from([]);
    let wire: HttpRequest | undefined;
    // The signing client cannot send to the network, even if its middleware retries.
    const client = new S3Client({
      region,
      credentials: { ...credentials },
      defaultsMode: 'standard',
      endpoint: `https://${hostname}`,
      forcePathStyle: true,
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      followRegionRedirects: false,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      requestHandler: {
        handle(signed: HttpRequest) {
          if (wire || signed.body !== body) throw invalidRequest();
          wire = HttpRequest.clone(signed);
          wire.body = undefined;
          return Promise.resolve({
            response: new HttpResponse({ statusCode: 200 }),
          });
        },
        destroy() {},
      },
    });
    const command = new PutObjectCommand({
      Bucket: request.bucket,
      Key: request.key,
      Body: body,
      ExpectedBucketOwner: request.expectedBucketOwner,
      IfNoneMatch: request.ifNoneMatch,
      ContentLength: request.contentLength,
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: request.checksumSHA256,
      ...(this.config.complianceRetainUntil && {
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: new Date(this.config.complianceRetainUntil),
      }),
      ContentType: request.contentType,
      ContentEncoding: request.contentEncoding,
      ContentLanguage: request.contentLanguage,
      ContentDisposition: request.contentDisposition,
      CacheControl: request.cacheControl,
      Metadata:
        auditMarker === undefined
          ? undefined
          : { [ITEM_PUT_AUDIT_METADATA]: auditMarker },
    });
    command.middlewareStack.add(
      (next) => (args) => {
        if (!HttpRequest.isInstance(args.request)) throw invalidRequest();
        args.request.headers['x-amz-content-sha256'] = payloadHash;
        return next(args);
      },
      { step: 'build', name: 'bindArchivePutPayloadHash' },
    );
    try {
      await client.send(command);
      if (!wire) throw invalidRequest();
      this.checkSignedRequest(
        wire,
        request,
        hostname,
        payloadHash,
        auditMarker,
      );
      return wire;
    } catch {
      throw invalidRequest();
    } finally {
      body.destroy();
      client.destroy();
    }
  }

  private checkSignedRequest(
    wire: HttpRequest,
    request: ItemPutTransportRequest,
    hostname: string,
    payloadHash: string,
    auditMarker?: string,
  ) {
    const path = request.key
      .split('/')
      .map((part) =>
        encodeURIComponent(part).replace(
          /[!'()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join('/');
    const expected: Record<string, string | undefined> = {
      host: hostname,
      'x-amz-content-sha256': payloadHash,
      'x-amz-checksum-sha256': request.checksumSHA256,
      'x-amz-sdk-checksum-algorithm': 'SHA256',
      'x-amz-object-lock-mode': this.config.complianceRetainUntil
        ? 'COMPLIANCE'
        : undefined,
      'x-amz-object-lock-retain-until-date': this.config.complianceRetainUntil,
      [`x-amz-meta-${ITEM_PUT_AUDIT_METADATA}`]: auditMarker,
      'x-amz-expected-bucket-owner': request.expectedBucketOwner,
      'if-none-match': request.ifNoneMatch,
      'cache-control': request.cacheControl,
      'content-length': String(request.contentLength),
      'content-type': request.contentType,
      'content-encoding': request.contentEncoding,
      'content-language': request.contentLanguage,
      'content-disposition': request.contentDisposition,
    };
    const { headers } = wire;
    const allowedHeaders = new Set([
      ...Object.keys(expected),
      ...allowedSdkHeaders,
    ]);
    const signedHeaders =
      /(?:^|,\s*)SignedHeaders=([^,]+)/
        .exec(headers.authorization ?? '')?.[1]
        .split(';') ?? [];
    if (
      wire.method !== 'PUT' ||
      wire.protocol !== 'https:' ||
      wire.hostname !== hostname ||
      (wire.port !== undefined && wire.port !== 443) ||
      wire.username ||
      wire.password ||
      wire.fragment ||
      wire.path !== `/${request.bucket}/${path}` ||
      Object.entries(wire.query).some(
        ([name, value]) => name !== 'x-id' || value !== 'PutObject',
      ) ||
      !headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ||
      !signedHeaders.includes('x-amz-date') ||
      (headers.expect !== undefined && headers.expect !== '100-continue') ||
      Object.keys(headers).some((name) => !allowedHeaders.has(name)) ||
      Object.entries(expected).some(
        ([name, value]) =>
          headers[name] !== value ||
          // The SDK excludes cache-control from SigV4. Its exact value is
          // still required here and included in the prepared request hash.
          (value !== undefined &&
            name !== 'cache-control' &&
            !signedHeaders.includes(name)),
      )
    )
      throw invalidRequest();
  }
}
