import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { HttpResponse } from '@smithy/protocol-http';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
} from './local-mongo-test-safety';
import { bounded, deferred } from './write-race-gate';

const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Node may pass normalized [options, callback] to Socket.connect. No Unix sockets. */
export function assertDispatchSocketTarget(
  args: unknown[],
  mongoPort: number,
): void {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  let host: unknown, port: unknown;
  if (first && typeof first === 'object') {
    const options = first as { host?: unknown; port?: unknown; path?: unknown };
    if (options.path !== undefined)
      throw new Error('Non-Mongo native sockets forbidden');
    host = options.host ?? 'localhost';
    port = options.port;
  } else if (typeof first === 'number') {
    port = first;
    host = typeof args[1] === 'string' ? args[1] : 'localhost';
  } else throw new Error('Non-Mongo native sockets forbidden');
  if (
    !loopback.includes(host as string) ||
    !(
      typeof port === 'number' ||
      (typeof port === 'string' && /^\d+$/.test(port))
    ) ||
    Number(port) !== mongoPort ||
    !Number.isSafeInteger(mongoPort) ||
    mongoPort < 1024 ||
    mongoPort > 65535
  )
    throw new Error('Non-Mongo native sockets forbidden');
}

type NativeSend = { method: string; path: string; source?: string };
type Step = () => HttpResponse | Promise<HttpResponse>;

/** Test-only native HTTP boundary. Mongo sockets remain real, on one local port. */
export class PromotionDispatchTransport {
  readonly requests: NativeSend[] = [];
  readonly steps: Step[] = [];
  private readonly restorers: Array<() => void> = [];
  private readonly releases: Array<() => void> = [];

  constructor(settings: LocalMongoTestSettings) {
    const checked = readLocalMongoTestSettings({
      ANIMAL_WRITE_MONGO_TESTS: '1',
      ANIMAL_WRITE_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    const mongoPort = Number(new URL(checked.uri).port);
    // The exact original method is invoked with its Socket receiver below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const connect = net.Socket.prototype.connect;
    const socket = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(function (this: net.Socket, ...args: unknown[]) {
        assertDispatchSocketTarget(args, mongoPort);
        return Reflect.apply(connect, this, args) as net.Socket;
      });
    this.restorers.push(() => socket.mockRestore());
    const plain = jest.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('Plain HTTP forbidden in dispatch harness');
    });
    this.restorers.push(() => plain.mockRestore());
    const secure = jest.spyOn(https, 'request').mockImplementation(((
      options: http.RequestOptions,
      callback: (response: http.IncomingMessage) => void,
    ) => {
      if (
        options.method !== 'PUT' ||
        ![
          'animalrecord-test-media.s3.us-east-1.amazonaws.com',
          'animalrecord-test-media.s3.us-west-2.amazonaws.com',
        ].includes(String(options.hostname ?? options.host)) ||
        (options.hostname !== undefined &&
          options.host !== undefined &&
          options.hostname !== options.host) ||
        (options.port !== undefined && Number(options.port) !== 443)
      )
        throw new Error('Unexpected native HTTPS target in dispatch harness');
      const headers = options.headers as Record<string, string>;
      this.requests.push({
        method: options.method,
        path: options.path!,
        source: headers['x-amz-copy-source'],
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
            if (!step)
              throw new Error('Unexpected native send in dispatch harness');
            return bounded(
              Promise.resolve().then(step),
              'synthetic native response',
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

  pauseNextResponse(response: HttpResponse) {
    const entered = deferred(),
      resume = deferred();
    this.releases.push(() => {
      entered.resolve();
      resume.resolve();
    });
    this.steps.push(async () => {
      entered.resolve();
      await bounded(resume.promise, 'synthetic response paused');
      return response;
    });
    return {
      entered: () => bounded(entered.promise, 'synthetic response entered'),
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
