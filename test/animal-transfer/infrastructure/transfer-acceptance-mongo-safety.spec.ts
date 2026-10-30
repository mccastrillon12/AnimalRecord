import { Connection } from 'mongoose';
import * as mongoose from 'mongoose';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import {
  ACCEPTANCE_COLLECTIONS,
  assertOwnedAcceptanceDatabase,
  createAcceptanceNamespace,
  readAcceptanceMongoSettings,
} from '../integration/support/transfer-acceptance-mongo-safety';
import { TransferAcceptanceMongoFixture } from '../integration/support/transfer-acceptance-mongo-fixture';
import { AcceptanceRaceGate } from '../integration/support/transfer-acceptance-race-gate';
import requireAcceptanceMongo from '../integration/support/require-transfer-acceptance-mongo';
import { FLOW_COLLECTIONS } from '../integration/support/transfer-flow-mongo-safety';
import {
  LocalMongoTestSettings,
  WRITE_TEST_COLLECTIONS,
  WRITE_TEST_MARKER,
} from '../integration/support/local-mongo-test-safety';
const uri =
  'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_acceptance_test&directConnection=true';
const env = {
  TRANSFER_ACCEPTANCE_MONGO_TESTS: '1',
  TRANSFER_ACCEPTANCE_MONGO_TEST_URI: uri,
};
const settings = { uri, replicaSet: 'animalrecord_acceptance_test' };

describe('Acceptance harness guardrails without Mongo or infrastructure', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    {},
    { ...env, TRANSFER_ACCEPTANCE_MONGO_TESTS: '0' },
    { TRANSFER_ACCEPTANCE_MONGO_TESTS: '1' },
    { TRANSFER_ACCEPTANCE_MONGO_TESTS: '1', MONGO_URI: uri },
    { TRANSFER_FLOW_MONGO_TESTS: '1', TRANSFER_FLOW_MONGO_TEST_URI: uri },
  ])('requires its own opt-in and URI %j', (input) => {
    expect(() => readAcceptanceMongoSettings(input)).toThrow();
  });
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts strict loopback %s',
    (host) => {
      const local = uri.replace('127.0.0.1', host);
      expect(
        readAcceptanceMongoSettings({
          ...env,
          TRANSFER_ACCEPTANCE_MONGO_TEST_URI: local,
        }),
      ).toEqual({ ...settings, uri: local });
    },
  );
  it.each([
    'mongodb+srv://atlas.invalid/?replicaSet=rs0',
    'mongodb://remote.invalid:27018/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    uri + '&tls=true',
    uri + '&replicaSet=other',
    uri + '\n',
    uri.replace('true', 'false'),
  ])('rejects unsafe URI %s', (value) => {
    expect(() =>
      readAcceptanceMongoSettings({
        ...env,
        TRANSFER_ACCEPTANCE_MONGO_TEST_URI: value,
      }),
    ).toThrow('Integration URI');
  });
  it('keeps its 19-collection allowlist and random namespace separate from all prior harnesses', () => {
    const n = createAcceptanceNamespace();
    expect(Object.isFrozen(n)).toBe(true);
    expect(n.databaseName).toMatch(
      /^animalrecord_acceptance_test_[a-f0-9]{32}$/,
    );
    expect(Buffer.byteLength(n.databaseName)).toBeLessThan(64);
    expect(n.databaseName).not.toBe(createAcceptanceNamespace().databaseName);
    expect(ACCEPTANCE_COLLECTIONS).toHaveLength(19);
    expect(new Set(ACCEPTANCE_COLLECTIONS).size).toBe(19);
    expect(FLOW_COLLECTIONS).toHaveLength(16);
    expect(WRITE_TEST_COLLECTIONS).toHaveLength(3);
    expect(FLOW_COLLECTIONS as readonly string[]).not.toContain(
      'animal_ownership_archive_entries',
    );
    expect(() =>
      assertOwnedAcceptanceDatabase(n, n.databaseName, n.runId, [
        ...ACCEPTANCE_COLLECTIONS,
      ]),
    ).not.toThrow();
  });
  it.each([
    'name',
    'marker',
    'foreign',
    'missing-marker',
    'run-id',
    'prefix',
  ] as const)('refuses cleanup on bad %s', (kind) => {
    const n = createAcceptanceNamespace();
    expect(() =>
      assertOwnedAcceptanceDatabase(
        kind === 'run-id'
          ? { ...n, runId: 'invalid' }
          : kind === 'prefix'
            ? { ...n, databaseName: 'animalrecord' }
            : n,
        kind === 'name' ? 'animalrecord' : n.databaseName,
        kind === 'marker' ? 'other' : n.runId,
        kind === 'foreign'
          ? [...ACCEPTANCE_COLLECTIONS, 'foreign']
          : kind === 'missing-marker'
            ? ACCEPTANCE_COLLECTIONS.filter((c) => c !== WRITE_TEST_MARKER)
            : [...ACCEPTANCE_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });
  it('rejects unsafe direct settings before connecting, including a mismatched replica set', async () => {
    class NoConnect extends TransferAcceptanceMongoFixture {
      readonly attempted = jest.fn();
      protected override connect(
        _settings: LocalMongoTestSettings,
        _side: string,
      ): Promise<Connection> {
        void _settings;
        void _side;
        this.attempted();
        throw new Error('Connection forbidden');
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
  it('keeps explicit connection/socket bounds without inheriting global CSOT into driver bulkWrite', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const create = jest
      .spyOn(mongoose, 'createConnection')
      .mockImplementation(() => {
        throw new Error('No connection in guard');
      });
    const f = new TransferAcceptanceMongoFixture();
    await expect(f.open(settings)).rejects.toThrow('No connection');
    expect(create).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({
        timeoutMS: undefined,
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
        socketTimeoutMS: 10000,
        bufferCommands: false,
        autoCreate: false,
        autoIndex: false,
      }),
    );
    await f.close();
  });
  it.each([
    'marker',
    'collection',
    'drop',
    'absence',
    'close',
    'none',
  ] as const)(
    'verifies ownership, absence and connection closure, failure=%s',
    async (failure) => {
      jest.spyOn(console, 'info').mockImplementation(() => undefined);
      class Owned extends TransferAcceptanceMongoFixture {
        readonly closed = jest.fn(() =>
          failure === 'close'
            ? Promise.reject(new Error('close failed'))
            : Promise.resolve(),
        );
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
                    ? [...ACCEPTANCE_COLLECTIONS, 'foreign']
                    : ACCEPTANCE_COLLECTIONS
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
  it('drains observed pending work and releases a barrier even when a scenario failed before release', async () => {
    const gate = new AcceptanceRaceGate(),
      pause = gate.arm('SNAPSHOT'),
      f = new TransferAcceptanceMongoFixture();
    const work = f.observe(gate.before('SNAPSHOT'));
    Object.defineProperty(f, 'left', { value: { gate } });
    await pause.entered();
    await f.drain();
    expect(await work).toEqual({ value: undefined });
    await f.close();
  });
  it('consumes a barrier and a fault once, allowing real driver retries to proceed', async () => {
    const gate = new AcceptanceRaceGate(),
      pause = gate.arm('DECISION'),
      work = gate.before('DECISION');
    await pause.entered();
    await gate.before('DECISION');
    pause.release();
    await work;
    gate.fail = 'HEADER';
    await expect(gate.before('HEADER')).rejects.toThrow('Injected');
    await gate.before('HEADER');
  });
  it('isolates discovery from npm test and from every other Mongo suite/configuration', () => {
    const root = resolve(__dirname, '../../'),
      names = readdirSync(resolve(root, 'animal-transfer/integration')).filter(
        (n) => n.endsWith('.mongo.integration.ts'),
      );
    for (const name of readdirSync(root).filter((n) =>
      /^jest-.*mongo\.json$/.test(n),
    )) {
      const config = JSON.parse(readFileSync(resolve(root, name), 'utf8')) as {
        testRegex: string;
        globalSetup: string;
      };
      expect(
        names.filter((n) => new RegExp(config.testRegex).test(n)),
      ).toHaveLength(1);
      if (name === 'jest-transfer-acceptance-mongo.json') {
        expect(config.globalSetup).toContain(
          'require-transfer-acceptance-mongo.ts',
        );
        expect(
          names.filter((n) => new RegExp(config.testRegex).test(n)),
        ).toEqual(['transfer-acceptance.mongo.integration.ts']);
      } else
        expect(
          new RegExp(config.testRegex).test(
            'transfer-acceptance.mongo.integration.ts',
          ),
        ).toBe(false);
    }
    const pkg = JSON.parse(
      readFileSync(resolve(root, '../package.json'), 'utf8'),
    ) as { scripts: Record<string, string>; jest: { testRegex: string } };
    expect(
      new RegExp(pkg.jest.testRegex).test(
        'transfer-acceptance.mongo.integration.ts',
      ),
    ).toBe(false);
    expect(pkg.scripts['test:integration:transfer-acceptance']).toContain(
      'jest-transfer-acceptance-mongo.json',
    );
    expect(pkg.scripts['test:integration:transfer-acceptance:check']).toContain(
      'tsc --project',
    );
  });
  it('counts 45 prepared cases by AST without evaluating their hooks or bootstrap', () => {
    const path = resolve(
      __dirname,
      '../integration/transfer-acceptance.mongo.integration.ts',
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
          let a = node.expression.arguments[0];
          while (ts.isAsExpression(a) || ts.isParenthesizedExpression(a))
            a = a.expression;
          if (!ts.isArrayLiteralExpression(a))
            throw new Error('Scenario table cannot be counted');
          count += a.elements.length;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(count).toBe(45);
    expect(source.text).not.toMatch(/AppModule|dotenv|Docker|firebase-admin/);
    const fixture = readFileSync(
      resolve(
        __dirname,
        '../integration/support/transfer-acceptance-mongo-fixture.ts',
      ),
      'utf8',
    );
    expect(fixture).not.toMatch(
      /AppModule|dotenv|Docker|client-s3|client-sns|createApplicationContext/,
    );
    expect(fixture).toContain('Storage I/O forbidden');
  });
  it('rejects disabled global setup before connecting or running any case', () => {
    const previous = process.env.TRANSFER_ACCEPTANCE_MONGO_TESTS;
    try {
      process.env.TRANSFER_ACCEPTANCE_MONGO_TESTS = '0';
      expect(() => requireAcceptanceMongo()).toThrow('opt-in');
    } finally {
      if (previous === undefined)
        delete process.env.TRANSFER_ACCEPTANCE_MONGO_TESTS;
      else process.env.TRANSFER_ACCEPTANCE_MONGO_TESTS = previous;
    }
  });
});
