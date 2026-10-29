import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { HttpResponse } from '@smithy/protocol-http';
import {
  MediaPromotionScope,
  promotionDefinition,
} from '../../../../src/context/animal-media/domain/media-promotion-effect';
import {
  AnimalMediaUpload,
  MediaRevision,
} from '../../../../src/context/animal-media/domain/animal-media-upload';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
} from './local-mongo-test-safety';
import { assertDispatchSocketTarget } from './promotion-dispatch-transport';
import { bounded, deferred } from './write-race-gate';

type Method = 'HEAD' | 'GET' | 'PUT';
type Binding = {
  definition: ReturnType<typeof promotionDefinition>;
  revision: MediaRevision;
};
/** Own boundary for the full cycle. Never expands earlier transport allowlists. */
export class PromotionConfirmTransport {
  readonly steps: Array<{
    method: Method;
    respond: () => HttpResponse | Promise<HttpResponse>;
  }> = [];
  readonly requests: Array<{
    method: Method;
    path: string;
    ifMatch?: string;
    versionId: string | null;
  }> = [];
  beforePut?: () => Promise<void>;
  private binding?: Binding;
  private readonly restorers: Array<() => void> = [];
  private readonly releases: Array<() => void> = [];
  private readonly pending = new Set<Promise<unknown>>();

  constructor(settings: LocalMongoTestSettings) {
    const checked = readLocalMongoTestSettings({
      ANIMAL_WRITE_MONGO_TESTS: '1',
      ANIMAL_WRITE_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    const port = Number(new URL(checked.uri).port);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const connect = net.Socket.prototype.connect;
    const socket = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(function (this: net.Socket, ...args: unknown[]) {
        assertDispatchSocketTarget(args, port);
        return Reflect.apply(connect, this, args) as net.Socket;
      });
    this.restorers.push(() => socket.mockRestore());
    const plain = jest.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('Plain HTTP forbidden in confirmation harness');
    });
    this.restorers.push(() => plain.mockRestore());
    const secure = jest.spyOn(https, 'request').mockImplementation(((
      options: http.RequestOptions,
      callback: (res: http.IncomingMessage) => void,
    ) => {
      const binding = this.binding;
      const method = options.method;
      if (
        !binding ||
        !['HEAD', 'GET', 'PUT'].includes(method ?? '') ||
        (options.hostname ?? options.host) !==
          'animalrecord-test-media.s3.us-east-1.amazonaws.com' ||
        (options.hostname !== undefined &&
          options.host !== undefined &&
          options.hostname !== options.host) ||
        (options.port !== undefined && Number(options.port) !== 443) ||
        (options.protocol !== undefined && options.protocol !== 'https:') ||
        typeof options.path !== 'string' ||
        !options.path.startsWith('/') ||
        options.path.startsWith('//')
      )
        throw new Error(
          'Unexpected native HTTPS target in confirmation harness',
        );
      const url = new URL(options.path, 'https://synthetic.invalid');
      const headers = options.headers as Record<string, string>;
      const d = binding.definition;
      const source =
        [d.bucket, ...d.source.key.split('/')]
          .map(encodeURIComponent)
          .join('/') +
        (d.source.versionId
          ? `?versionId=${encodeURIComponent(d.source.versionId)}`
          : '');
      if (
        decodeURIComponent(url.pathname) !== '/' + d.destinationKey ||
        url.hash ||
        [...url.searchParams.keys()].some(
          (k) => !['x-id', 'versionId'].includes(k),
        ) ||
        url.searchParams.getAll('x-id').length > 1 ||
        url.searchParams.getAll('versionId').length > 1 ||
        (url.searchParams.has('x-id') &&
          url.searchParams.get('x-id') !==
            (method === 'HEAD'
              ? 'HeadObject'
              : method === 'GET'
                ? 'GetObject'
                : 'CopyObject')) ||
        (method !== 'GET' && url.searchParams.has('versionId')) ||
        (method === 'GET' &&
          (headers['if-match'] !== binding.revision.etag ||
            url.searchParams.get('versionId') !==
              (binding.revision.versionId ?? null))) ||
        (method === 'PUT' &&
          (headers['x-amz-copy-source'] !== source ||
            headers['x-amz-copy-source-if-match'] !== d.source.etag ||
            headers['if-none-match'] !== '*' ||
            headers['x-amz-metadata-directive'] !== 'REPLACE' ||
            headers['content-type'] !== d.mimeType ||
            headers['x-amz-meta-animal-upload-id'] !== d.uploadId ||
            headers['x-amz-meta-animal-upload-sha256'] !== d.source.sha256))
      )
        throw new Error('Unexpected native request in confirmation harness');
      this.requests.push({
        method: method as Method,
        path: options.path,
        ifMatch: headers['if-match'],
        versionId: url.searchParams.get('versionId'),
      });
      const request = new Writable({
        write(chunk: Buffer, _encoding, done) {
          done(
            chunk.byteLength
              ? new Error('Request body forbidden in confirmation harness')
              : undefined,
          );
        },
      });
      request.on('finish', () => {
        const step = this.steps.shift();
        const work = Promise.resolve()
          .then(async () => {
            if (!step || step.method !== method)
              throw new Error('Unexpected confirmation request sequence');
            if (method === 'PUT')
              await bounded(
                this.track(Promise.resolve().then(() => this.beforePut?.())),
                'confirmation permission visible',
              );
            return bounded(
              this.track(Promise.resolve().then(step.respond)),
              'synthetic confirmation response',
            );
          })
          .then(
            (response) => {
              const body: unknown = response.body;
              callback(
                Object.assign(
                  body instanceof Readable ? body : Readable.from([]),
                  {
                    statusCode: response.statusCode,
                    headers: response.headers,
                  },
                ) as unknown as http.IncomingMessage,
              );
            },
            (error: unknown) => {
              request.emit('error', error);
            },
          );
        void this.track(work);
      });
      return request as unknown as http.ClientRequest;
    }) as typeof https.request);
    this.restorers.push(() => secure.mockRestore());
  }
  bind(
    scope: MediaPromotionScope,
    upload: AnimalMediaUpload,
    revision: MediaRevision,
  ): void {
    if (this.binding)
      throw new Error('Confirmation transport is already bound');
    const definition = promotionDefinition(
      scope,
      upload,
      'animalrecord-test-media',
    );
    this.binding = { definition, revision: { ...revision } };
  }
  pause(method: Method, response: HttpResponse) {
    const entered = deferred(),
      resume = deferred();
    this.releases.push(() => {
      entered.resolve();
      resume.resolve();
    });
    this.steps.push({
      method,
      respond: async () => {
        entered.resolve();
        await bounded(resume.promise, 'confirmation response pause');
        return response;
      },
    });
    return {
      entered: () => bounded(entered.promise, 'confirmation response entered'),
      release: resume.resolve,
    };
  }
  releaseAll(): void {
    for (const release of this.releases.splice(0)) release();
  }
  async drain(): Promise<void> {
    this.releaseAll();
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise
      .finally(() => this.pending.delete(promise))
      .catch(() => undefined);
    return promise;
  }
  restore(): void {
    this.releaseAll();
    for (const restore of this.restorers.splice(0).reverse()) restore();
  }
}
