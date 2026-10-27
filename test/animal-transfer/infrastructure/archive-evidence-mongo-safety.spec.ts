import { Connection } from 'mongoose';
import { ArchiveEvidenceMongoFixture } from '../integration/support/archive-evidence-mongo-fixture';
import {
  assertOwnedEvidenceTestDatabase,
  createEvidenceTestNamespace,
  EVIDENCE_TEST_COLLECTIONS,
  readArchiveEvidenceMongoSettings,
} from '../integration/support/archive-evidence-mongo-safety';
import {
  assertOwnedWriteTestDatabase,
  createWriteTestNamespace,
  WRITE_TEST_COLLECTIONS,
} from '../integration/support/local-mongo-test-safety';
import { EvidenceRaceGate } from '../integration/support/evidence-race-gate';

const uri = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test';
const env = {
  ARCHIVE_EVIDENCE_MONGO_TESTS: '1',
  ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri,
};

class CleanupProbe extends ArchiveEvidenceMongoFixture {
  install(collections: string[]) {
    const drop = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    this.connections = [
      {
        db: {
          databaseName: this.namespace.databaseName,
          collection: () => ({
            findOne: () => Promise.resolve({ runId: this.namespace.runId }),
          }),
          listCollections: () => ({
            toArray: () =>
              Promise.resolve(collections.map((name) => ({ name }))),
          }),
          dropDatabase: drop,
        },
        close,
      } as unknown as Connection,
    ];
    this.ownsDatabase = true;
    return { drop, close };
  }
}

describe('Archive evidence Mongo harness safeguards (no connections)', () => {
  it.each([false, true])(
    'shared cleanup applies the evidence profile and closes connections even when refused (extra=%s)',
    async (extra) => {
      const probe = new CleanupProbe();
      const calls = probe.install([
        ...EVIDENCE_TEST_COLLECTIONS,
        ...(extra ? ['users'] : []),
      ]);
      if (extra) await expect(probe.close()).rejects.toThrow('cleanup refused');
      else await probe.close();
      expect(calls.drop).toHaveBeenCalledTimes(extra ? 0 : 1);
      expect(calls.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    {},
    { MONGO_URI: uri },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { ...env, ARCHIVE_EVIDENCE_MONGO_TESTS: '0' },
    { ARCHIVE_EVIDENCE_MONGO_TESTS: '1' },
  ])(
    'requires its own opt-in and URI without application/journal fallback',
    (input) => {
      expect(() => readArchiveEvidenceMongoSettings(input)).toThrow();
    },
  );
  it('uses the strict loopback parser', () => {
    expect(readArchiveEvidenceMongoSettings(env)).toEqual({
      uri,
      replicaSet: 'animalrecord_test',
    });
  });
  it.each([
    'mongodb://remote.example:27018/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    'mongodb+srv://remote.example/?replicaSet=rs0',
  ])('refuses unsafe URI without echoing it', (invalid) => {
    expect(() =>
      readArchiveEvidenceMongoSettings({
        ...env,
        ARCHIVE_EVIDENCE_MONGO_TEST_URI: invalid,
      }),
    ).toThrow('Integration URI');
    try {
      readArchiveEvidenceMongoSettings({
        ...env,
        ARCHIVE_EVIDENCE_MONGO_TEST_URI: invalid,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(invalid);
    }
  });
  it('generates immutable namespaces distinct from every other run and the journal profile', () => {
    const ns = createEvidenceTestNamespace();
    expect(ns.databaseName).toMatch(
      /^animalrecord_evidence_test_[a-f0-9]{32}$/,
    );
    expect(ns.databaseName).not.toBe(
      createEvidenceTestNamespace().databaseName,
    );
    expect(Object.isFrozen(ns)).toBe(true);
    expect(() =>
      assertOwnedEvidenceTestDatabase(ns, ns.databaseName, ns.runId, [
        ...EVIDENCE_TEST_COLLECTIONS,
      ]),
    ).not.toThrow();
    const journal = createWriteTestNamespace();
    expect(() =>
      assertOwnedEvidenceTestDatabase(
        journal,
        journal.databaseName,
        journal.runId,
        [...EVIDENCE_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
    expect(() =>
      assertOwnedWriteTestDatabase(ns, ns.databaseName, ns.runId, [
        ...WRITE_TEST_COLLECTIONS,
      ]),
    ).toThrow('cleanup refused');
    expect(() =>
      assertOwnedWriteTestDatabase(
        journal,
        journal.databaseName,
        journal.runId,
        [...EVIDENCE_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });
  it.each([
    'database',
    'marker',
    'missing marker',
    'extra collection',
    'application namespace',
    'journal collection',
  ])('refuses cleanup on %s mismatch', (problem) => {
    const ns = createEvidenceTestNamespace();
    expect(() =>
      assertOwnedEvidenceTestDatabase(
        problem === 'application namespace'
          ? { ...ns, databaseName: 'animalrecord' }
          : ns,
        problem === 'database' ? 'animalrecord' : ns.databaseName,
        problem === 'marker' ? 'other-run' : ns.runId,
        problem === 'missing marker'
          ? []
          : [
              ...EVIDENCE_TEST_COLLECTIONS,
              ...(problem === 'extra collection'
                ? ['users']
                : problem === 'journal collection'
                  ? ['animal_write_journals']
                  : []),
            ],
      ),
    ).toThrow('cleanup refused');
  });
  it('releases a one-shot race barrier and lets subsequent attempts continue', async () => {
    const gate = new EvidenceRaceGate();
    const barrier = gate.arm('CONTROL');
    const blocked = gate.before('CONTROL');
    await barrier.entered();
    await gate.before('CONTROL');
    gate.releaseAll();
    await blocked;
  });
  it('rejects double arming and releases an entered barrier during cleanup', async () => {
    const gate = new EvidenceRaceGate();
    const barrier = gate.arm('RUN');
    expect(() => gate.arm('HEADER')).toThrow('already armed');
    const blocked = gate.before('RUN');
    await barrier.entered();
    gate.releaseAll();
    await blocked;
  });
});
