import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { HttpResponse } from '@smithy/protocol-http';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
} from './local-mongo-test-safety';
import { assertDispatchSocketTarget } from './promotion-dispatch-transport';
import { bounded, deferred } from './write-race-gate';

type Method = 'HEAD' | 'GET';
type Step = {
  method: Method;
  respond: () => HttpResponse | Promise<HttpResponse>;
};
export class PromotionSealTransport {
  readonly steps: Step[] = [];
  readonly requests: Array<{
    method: Method;
    path: string;
    ifMatch?: string;
    versionId: string | null;
  }> = [];
  private destination?: string;
  private readonly restorers: Array<() => void> = [];
  private readonly releases: Array<() => void> = [];

  constructor(settings: LocalMongoTestSettings) {
    const checked = readLocalMongoTestSettings({
      ANIMAL_WRITE_MONGO_TESTS: '1',
      ANIMAL_WRITE_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    const port = Number(new URL(checked.uri).port);
    // Preserve the exact Socket receiver with Reflect.apply below.
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
      throw new Error('Plain HTTP forbidden in seal harness');
    });
    this.restorers.push(() => plain.mockRestore());
    const secure = jest.spyOn(https, 'request').mockImplementation(((
      options: http.RequestOptions,
      callback: (res: http.IncomingMessage) => void,
    ) => {
      const method = options.method;
      if (
        !this.destination ||
        (method !== 'HEAD' && method !== 'GET') ||
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
        throw new Error('Unexpected native HTTPS target in seal harness');
      const url = new URL(options.path, 'https://synthetic.invalid');
      const headers = options.headers as Record<string, string>;
      if (
        decodeURIComponent(url.pathname) !== '/' + this.destination ||
        url.hash ||
        [...url.searchParams.keys()].some(
          (k) => !['x-id', 'versionId'].includes(k),
        ) ||
        url.searchParams.getAll('versionId').length > 1 ||
        url.searchParams.getAll('x-id').length > 1 ||
        (url.searchParams.has('x-id') &&
          url.searchParams.get('x-id') !==
            (method === 'HEAD' ? 'HeadObject' : 'GetObject')) ||
        (method === 'HEAD' && url.searchParams.has('versionId')) ||
        (method === 'GET' && !headers['if-match'])
      )
        throw new Error('Unexpected native read request in seal harness');
      this.requests.push({
        method,
        path: options.path,
        ifMatch: headers['if-match'],
        versionId: url.searchParams.get('versionId'),
      });
      const request = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      request.on('finish', () => {
        const step = this.steps.shift();
        void Promise.resolve()
          .then(() => {
            if (!step || step.method !== method)
              throw new Error('Unexpected read sequence in seal harness');
            return bounded(
              Promise.resolve().then(step.respond),
              'synthetic seal response',
            );
          })
          .then(
            (response) => {
              const body: unknown = response.body;
              const stream =
                body instanceof Readable ? body : Readable.from([]);
              callback(
                Object.assign(stream, {
                  statusCode: response.statusCode,
                  headers: response.headers,
                }) as unknown as http.IncomingMessage,
              );
            },
            (error: unknown) => request.emit('error', error),
          );
      });
      return request as unknown as http.ClientRequest;
    }) as typeof https.request);
    this.restorers.push(() => secure.mockRestore());
  }
  bindDestination(key: string): void {
    if (
      this.destination ||
      !/^users\/[0-9a-f-]+\/animals\/[0-9a-f-]+\/(?:profile_\d+\.(?:jpeg|png|webp)|diary\/[0-9a-f-]+\/[0-9a-f-]+\.[a-z0-9]+)$/.test(
        key,
      )
    )
      throw new Error('Seal harness requires one ordinary destination');
    this.destination = key;
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
        await bounded(resume.promise, 'seal response pause');
        return response;
      },
    });
    return {
      entered: () => bounded(entered.promise, 'seal response entered'),
      release: resume.resolve,
    };
  }
  releaseAll(): void {
    for (const release of this.releases.splice(0)) release();
  }
  restore(): void {
    this.releaseAll();
    for (const restore of this.restorers.splice(0).reverse()) restore();
  }
}
