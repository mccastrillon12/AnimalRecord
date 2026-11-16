import {
  assertOwnedWriteTestDatabase,
  createWriteTestNamespace,
  readLocalMongoTestSettings,
  WRITE_TEST_COLLECTIONS,
} from '../integration/support/local-mongo-test-safety';

const env = {
  ANIMAL_WRITE_MONGO_TESTS: '1',
  ANIMAL_WRITE_MONGO_TEST_URI:
    'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test',
};

describe('Opt-in local Mongo integration guards (no connections)', () => {
  it('requires explicit opt-in and a dedicated URI without falling back to application configuration', () => {
    for (const invalid of [
      {},
      { MONGO_URI: env.ANIMAL_WRITE_MONGO_TEST_URI },
      { ...env, ANIMAL_WRITE_MONGO_TESTS: '0' },
      { ANIMAL_WRITE_MONGO_TESTS: '1' },
    ])
      expect(() => readLocalMongoTestSettings(invalid)).toThrow();
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts only an explicit local endpoint (%s) and replica set',
    (host) => {
      const uri = `mongodb://${host}:27018/?replicaSet=animalrecord_test&directConnection=true`;
      expect(
        readLocalMongoTestSettings({
          ...env,
          ANIMAL_WRITE_MONGO_TEST_URI: uri,
        }),
      ).toEqual({ uri, replicaSet: 'animalrecord_test' });
    },
  );

  it.each([
    'mongodb+srv://remote.example/?replicaSet=rs0',
    'mongodb://remote.example:27018/?replicaSet=rs0',
    'mongodb://localhost.evil.example:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018,localhost:27019/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    'mongodb://127.0.0.1/?replicaSet=rs0',
    'mongodb://127.0.0.1:80/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=false',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&replicaSet=other',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&authSource=admin',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0#fragment',
  ])(
    'refuses non-isolated or ambiguous URI without including it in the error',
    (uri) => {
      try {
        readLocalMongoTestSettings({
          ...env,
          ANIMAL_WRITE_MONGO_TEST_URI: uri,
        });
        throw new Error('Expected rejection');
      } catch (error) {
        expect((error as Error).message).toMatch(/Integration URI/);
        expect((error as Error).message).not.toContain(uri);
        expect((error as Error).message).not.toContain('secret');
      }
    },
  );

  it('generates a separate immutable database namespace per run', () => {
    const first = createWriteTestNamespace(),
      second = createWriteTestNamespace();
    expect(first.databaseName).toMatch(
      /^animalrecord_write_test_[a-f0-9]{32}$/,
    );
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('permits cleanup only with the exact generated namespace, ownership marker and collection allowlist', () => {
    const ns = createWriteTestNamespace();
    expect(() =>
      assertOwnedWriteTestDatabase(ns, ns.databaseName, ns.runId, [
        ...WRITE_TEST_COLLECTIONS,
      ]),
    ).not.toThrow();
    for (const [database, marker, collections] of [
      ['animalrecord', ns.runId, [...WRITE_TEST_COLLECTIONS]],
      [ns.databaseName, 'other-run', [...WRITE_TEST_COLLECTIONS]],
      [ns.databaseName, undefined, [...WRITE_TEST_COLLECTIONS]],
      [ns.databaseName, ns.runId, ['users', ...WRITE_TEST_COLLECTIONS]],
      [ns.databaseName, ns.runId, ['animal_write_journals']],
    ] as Array<[string, unknown, string[]]>)
      expect(() =>
        assertOwnedWriteTestDatabase(ns, database, marker, collections),
      ).toThrow('cleanup refused');
    expect(() =>
      assertOwnedWriteTestDatabase(
        { ...ns, databaseName: 'admin' },
        'admin',
        ns.runId,
        [...WRITE_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });
});
