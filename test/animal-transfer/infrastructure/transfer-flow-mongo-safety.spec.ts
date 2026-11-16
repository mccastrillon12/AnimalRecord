import { Connection } from 'mongoose';
import * as mongoose from 'mongoose';
import { WriteMongoFixture } from '../integration/support/write-mongo-fixture';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import {
  assertOwnedFlowDatabase,
  createFlowNamespace,
  FLOW_COLLECTIONS,
  readTransferFlowMongoSettings,
} from '../integration/support/transfer-flow-mongo-safety';
import { TransferFlowMongoFixture } from '../integration/support/transfer-flow-mongo-fixture';
import { FlowRaceGate } from '../integration/support/transfer-flow-race-gate';
import {
  LocalMongoTestSettings,
  WRITE_TEST_COLLECTIONS,
  WRITE_TEST_MARKER,
} from '../integration/support/local-mongo-test-safety';
import { CONFIRM_TEST_COLLECTIONS } from '../integration/support/media-promotion-confirm-mongo-safety';
import requireTransferFlowMongo from '../integration/support/require-transfer-flow-mongo';

const uri =
  'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_flow_test&directConnection=true';
const env = {
  TRANSFER_FLOW_MONGO_TESTS: '1',
  TRANSFER_FLOW_MONGO_TEST_URI: uri,
};
const settings = { uri, replicaSet: 'animalrecord_flow_test' };
describe('Transfer flow harness safety, no Mongo connection or infrastructure', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    {},
    { ...env, TRANSFER_FLOW_MONGO_TESTS: '0' },
    { TRANSFER_FLOW_MONGO_TESTS: '1' },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { TRANSFER_FLOW_MONGO_TESTS: '1', MONGO_URI: uri },
  ])('requires its own opt-in and exact URI variable %j', (input) => {
    expect(() => readTransferFlowMongoSettings(input)).toThrow();
  });
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the strict loopback host %s',
    (host) => {
      const local = uri.replace('127.0.0.1', host);
      expect(
        readTransferFlowMongoSettings({
          ...env,
          TRANSFER_FLOW_MONGO_TEST_URI: local,
        }),
      ).toEqual({ uri: local, replicaSet: settings.replicaSet });
    },
  );
  it.each([
    'mongodb+srv://atlas.invalid/?replicaSet=rs0',
    'mongodb://remote.invalid:27018/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    uri + '&tls=true',
    uri + '&replicaSet=other',
    uri.replace('true', 'false'),
    uri + '\n',
    'mongodb://127.0.0.1:27018,localhost:27019/?replicaSet=rs0',
  ])('rejects unsafe URI %s', (value) => {
    expect(() =>
      readTransferFlowMongoSettings({
        ...env,
        TRANSFER_FLOW_MONGO_TEST_URI: value,
      }),
    ).toThrow('Integration URI');
  });
  it('uses a fresh frozen namespace and a closed allowlist independent of previous harnesses', () => {
    const namespace = createFlowNamespace();
    expect(Object.isFrozen(namespace)).toBe(true);
    expect(namespace.databaseName).toMatch(
      /^animalrecord_flow_test_[a-f0-9]{32}$/,
    );
    expect(Buffer.byteLength(namespace.databaseName)).toBeLessThan(64);
    expect(namespace.databaseName).not.toBe(createFlowNamespace().databaseName);
    expect(FLOW_COLLECTIONS).toHaveLength(16);
    expect(new Set(FLOW_COLLECTIONS).size).toBe(16);
    expect(WRITE_TEST_COLLECTIONS).toHaveLength(3);
    expect(CONFIRM_TEST_COLLECTIONS).toHaveLength(5);
    expect(WRITE_TEST_COLLECTIONS as readonly string[]).not.toContain(
      'notification_outbox',
    );
    expect(CONFIRM_TEST_COLLECTIONS as readonly string[]).not.toContain(
      'animal_transfers',
    );
    expect(() =>
      assertOwnedFlowDatabase(
        namespace,
        namespace.databaseName,
        namespace.runId,
        [...FLOW_COLLECTIONS],
      ),
    ).not.toThrow();
  });
  it.each([
    'name',
    'marker',
    'collection',
    'missing-marker',
    'prefix',
    'run-id',
  ] as const)('refuses cleanup when %s is not owned', (kind) => {
    const n = createFlowNamespace();
    expect(() =>
      assertOwnedFlowDatabase(
        kind === 'prefix'
          ? { ...n, databaseName: 'animalrecord' }
          : kind === 'run-id'
            ? { ...n, runId: 'invalid' }
            : n,
        kind === 'name' ? 'animalrecord' : n.databaseName,
        kind === 'marker' ? 'other' : n.runId,
        kind === 'collection'
          ? [...FLOW_COLLECTIONS, 'foreign']
          : kind === 'missing-marker'
            ? FLOW_COLLECTIONS.filter((c) => c !== WRITE_TEST_MARKER)
            : [...FLOW_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });
  it('revalidates direct fixture settings before reaching a connection', async () => {
    class NoConnect extends TransferFlowMongoFixture {
      readonly attempted = jest.fn();
      protected override connect(
        _settings: LocalMongoTestSettings,
        _side: string,
      ): Promise<Connection> {
        void _settings;
        void _side;
        this.attempted();
        throw new Error('Connection forbidden in unit guard');
      }
    }
    const f = new NoConnect();
    await expect(
      f.open({
        ...settings,
        uri: 'mongodb://remote.invalid:27018/?replicaSet=rs0',
      }),
    ).rejects.toThrow('Integration URI');
    await expect(f.open({ ...settings, replicaSet: 'other' })).rejects.toThrow(
      'disagree',
    );
    expect(f.attempted).not.toHaveBeenCalled();
    await f.close();
  });
  it('keeps the application clock advancing with real createdAt timestamps while supporting explicit retry offsets', async () => {
    const initial = Date.now(),
      now = jest.spyOn(Date, 'now').mockReturnValue(initial);
    const f = new TransferFlowMongoFixture();
    now.mockReturnValue(initial + 2000);
    expect(f.clock().getTime()).toBe(initial + 2000);
    f.advance(30000);
    expect(f.clock().getTime()).toBe(initial + 32000);
    await f.close();
  });
  it('omits global CSOT only for this harness, keeping connection/socket bounds and prior fixture defaults', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const create = jest
      .spyOn(mongoose, 'createConnection')
      .mockImplementation(() => {
        throw new Error('No connection in this guard');
      });
    const f = new TransferFlowMongoFixture();
    await expect(f.open(settings)).rejects.toThrow('No connection');
    expect(create).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({
        timeoutMS: undefined,
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
        socketTimeoutMS: 10000,
        bufferCommands: false,
      }),
    );
    class Prior extends WriteMongoFixture {
      timeout() {
        return this.clientTimeoutMS();
      }
    }
    expect(new Prior().timeout()).toBe(15000);
    await f.close();
  });
  it.each(['marker', 'collection', 'drop', 'absence', 'none'] as const)(
    'verifies cleanup and closes clients; injected failure: %s',
    async (failure) => {
      jest.spyOn(console, 'info').mockImplementation(() => undefined);
      class Owned extends TransferFlowMongoFixture {
        readonly closed = jest
          .fn<Promise<void>, []>()
          .mockResolvedValue(undefined);
        readonly drop = jest.fn(() =>
          failure === 'drop'
            ? Promise.reject(new Error('drop failed'))
            : Promise.resolve(true),
        );
        constructor() {
          super();
          const db = {
            databaseName: this.namespace.databaseName,
            collection: () => ({
              findOne: () =>
                Promise.resolve({
                  runId: failure === 'marker' ? 'other' : this.namespace.runId,
                }),
            }),
            listCollections: () => ({
              toArray: () =>
                Promise.resolve(
                  (failure === 'collection'
                    ? [...FLOW_COLLECTIONS, 'foreign']
                    : FLOW_COLLECTIONS
                  ).map((name) => ({ name })),
                ),
            }),
            dropDatabase: this.drop,
            admin: () => ({
              listDatabases: () =>
                Promise.resolve({
                  databases:
                    failure === 'absence'
                      ? [{ name: this.namespace.databaseName }]
                      : [],
                }),
            }),
          };
          this.connections = [
            { db, close: this.closed } as unknown as Connection,
          ];
          this.ownsDatabase = true;
        }
      }
      const f = new Owned();
      if (failure === 'none') await expect(f.close()).resolves.toBeUndefined();
      else await expect(f.close()).rejects.toThrow();
      expect(f.closed).toHaveBeenCalledTimes(1);
      expect(f.drop).toHaveBeenCalledTimes(
        failure === 'marker' || failure === 'collection' ? 0 : 1,
      );
    },
  );
  it('drains a paused observed operation before cleanup even after an assertion fails', async () => {
    const gate = new FlowRaceGate(),
      pause = gate.arm('DEVICE_FENCE'),
      f = new TransferFlowMongoFixture();
    const work = f.observe(gate.before('DEVICE_FENCE'));
    Object.defineProperty(f, 'left', { value: { gate } });
    await pause.entered();
    await f.drain();
    expect(await work).toEqual({ value: undefined });
    await f.close();
  });
  it('consumes a barrier once, lets driver retries proceed, and injects a failure once', async () => {
    const gate = new FlowRaceGate(),
      pause = gate.arm('REJECT');
    const waiting = gate.before('REJECT');
    await pause.entered();
    await gate.before('REJECT');
    pause.release();
    await waiting;
    gate.fail = 'NOTICE';
    await expect(gate.before('NOTICE')).rejects.toThrow('Injected');
    await gate.before('NOTICE');
  });
  it('discovers only its own integration suite and keeps it outside npm test', () => {
    const config = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../jest-transfer-flow-mongo.json'),
        'utf8',
      ),
    ) as { testRegex: string; globalSetup: string };
    expect(
      new RegExp(config.testRegex).test('transfer-flow.mongo.integration.ts'),
    ).toBe(true);
    expect(
      new RegExp(config.testRegex).test(
        'media-promotion-confirm.mongo.integration.ts',
      ),
    ).toBe(false);
    expect(config.globalSetup).toContain('require-transfer-flow-mongo.ts');
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string>; jest: { testRegex: string } };
    expect(
      new RegExp(pkg.jest.testRegex).test('transfer-flow.mongo.integration.ts'),
    ).toBe(false);
    expect(pkg.scripts['test:integration:transfer-flow:check']).toContain(
      'tsc --project',
    );
    expect(pkg.scripts['test:integration:transfer-flow']).toContain(
      'jest-transfer-flow-mongo.json',
    );
  });
  it('counts 47 prepared scenarios by syntax only, without evaluating their hooks or connecting', () => {
    const path = resolve(
      __dirname,
      '../integration/transfer-flow.mongo.integration.ts',
    );
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    let count = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'it')
          count++;
        else if (
          ts.isCallExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === 'each'
        ) {
          let argument = node.expression.arguments[0];
          while (
            ts.isAsExpression(argument) ||
            ts.isParenthesizedExpression(argument)
          )
            argument = argument.expression;
          if (!ts.isArrayLiteralExpression(argument))
            throw new Error('Scenario table cannot be counted');
          count += argument.elements.length;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(count).toBe(47);
    const text = source.text;
    expect(text).not.toMatch(/AppModule|dotenv|Docker|firebase-admin/);
  });
  it('global setup rejects disabled opt-in before any fixture runs', () => {
    const previous = process.env.TRANSFER_FLOW_MONGO_TESTS;
    try {
      process.env.TRANSFER_FLOW_MONGO_TESTS = '0';
      expect(() => requireTransferFlowMongo()).toThrow('opt-in');
    } finally {
      if (previous === undefined) delete process.env.TRANSFER_FLOW_MONGO_TESTS;
      else process.env.TRANSFER_FLOW_MONGO_TESTS = previous;
    }
  });
});
