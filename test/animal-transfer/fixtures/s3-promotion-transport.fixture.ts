import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import { ConfiguredRetryStrategy } from '@smithy/util-retry';
import { Readable } from 'node:stream';

export const copyCommand = () =>
  new CopyObjectCommand({
    Bucket: 'animalrecord-transport-test',
    Key: 'synthetic/final',
    CopySource:
      'animalrecord-transport-test/synthetic/source?versionId=source-version',
    CopySourceIfMatch: '"source-etag"',
    IfNoneMatch: '*',
    MetadataDirective: 'REPLACE',
    ContentType: 'image/jpeg',
    Metadata: {
      'animal-upload-id': 'synthetic-upload',
      'animal-upload-sha256': 'a'.repeat(64),
    },
  });

export function xmlResponse(
  statusCode = 200,
  code?: string,
  headers: Record<string, string> = {},
) {
  const xml = code
    ? `<Error><Code>${code}</Code><Message>Synthetic transport response</Message></Error>`
    : '<CopyObjectResult><ETag>"final-etag"</ETag><LastModified>2026-10-27T00:00:00Z</LastModified></CopyObjectResult>';
  return new HttpResponse({
    statusCode,
    headers: { 'content-type': 'application/xml', ...headers },
    body: Readable.from([Buffer.from(xml)]),
  });
}

export type TransportStep = (
  request: HttpRequest,
) => HttpResponse | Promise<HttpResponse>;
export type TransportEvent = {
  method: string;
  hostname: string;
  path: string;
  copySource?: string;
  sourceMatch?: string;
  destinationMatch?: string;
  attempt?: string;
};
const event = (request: HttpRequest): TransportEvent => ({
  method: request.method,
  hostname: request.hostname,
  path: request.path,
  copySource: request.headers['x-amz-copy-source'],
  sourceMatch: request.headers['x-amz-copy-source-if-match'],
  destinationMatch: request.headers['if-none-match'],
  attempt: request.headers['amz-sdk-request'],
});

export function transportFixture(
  steps: TransportStep[],
  options: {
    maxAttempts?: number;
    followRegionRedirects?: boolean;
    beforeSend?: (invocation: number) => Promise<void>;
    duplicateInsideHandler?: boolean;
  } = {},
) {
  const invocations: TransportEvent[] = [],
    sends: TransportEvent[] = [];
  let consumed = 0;
  const sink = async (request: HttpRequest) => {
    sends.push(event(request));
    const step = steps[consumed++];
    if (!step) throw new Error('Unexpected synthetic transport send');
    return step(request);
  };
  const handler = {
    handle: async (request: HttpRequest) => {
      invocations.push(event(request));
      await options.beforeSend?.(invocations.length);
      // Deliberate negative fixture: a wrapper cannot cover arbitrary handler internals.
      if (options.duplicateInsideHandler) await sink(request);
      return { response: await sink(request) };
    },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
    destroy: () => undefined,
  };
  const client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'SYNTHETIC',
      secretAccessKey: 'synthetic-secret',
    },
    defaultsMode: 'standard',
    retryMode: 'standard',
    maxAttempts: options.maxAttempts ?? 3,
    retryStrategy: new ConfiguredRetryStrategy(options.maxAttempts ?? 3, 0),
    followRegionRedirects: options.followRegionRedirects ?? false,
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    useArnRegion: false,
    disableS3ExpressSessionAuth: true,
    userAgentAppId: 'synthetic-transport-test',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: handler,
  });
  return { client, handler, invocations, sends };
}
