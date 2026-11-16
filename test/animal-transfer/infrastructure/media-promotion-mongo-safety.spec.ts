import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mongoose from 'mongoose';
import { MediaPromotionMongoFixture } from '../integration/support/media-promotion-mongo-fixture';
import {
  assertOwnedPromotionTestDatabase,
  createPromotionTestNamespace,
  PROMOTION_TEST_COLLECTIONS,
  readMediaPromotionMongoSettings,
} from '../integration/support/media-promotion-mongo-safety';
import {
  WRITE_TEST_COLLECTIONS,
  WRITE_TEST_MARKER,
} from '../integration/support/local-mongo-test-safety';
import { EVIDENCE_TEST_COLLECTIONS } from '../integration/support/archive-evidence-mongo-safety';
import { PromotionRaceGate } from '../integration/support/promotion-race-gate';

const uri = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test';
const env = {
  MEDIA_PROMOTION_MONGO_TESTS: '1',
  MEDIA_PROMOTION_MONGO_TEST_URI: uri,
};

describe('Media promotion Mongo harness isolation (no connections)', () => {
  it.each([
    {},
    { MONGO_URI: uri },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { ARCHIVE_EVIDENCE_MONGO_TESTS: '1', ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri },
    {
      ARCHIVE_PROJECTION_MONGO_TESTS: '1',
      ARCHIVE_PROJECTION_MONGO_TEST_URI: uri,
    },
    { ...env, MEDIA_PROMOTION_MONGO_TESTS: '0' },
    { MEDIA_PROMOTION_MONGO_TESTS: '1' },
    {
      MEDIA_PROMOTION_MONGO_TESTS: '1',
      MONGO_URI: uri,
      ANIMAL_WRITE_MONGO_TEST_URI: uri,
      ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri,
      ARCHIVE_PROJECTION_MONGO_TEST_URI: uri,
    },
  ])('requires both its own opt-in and its own URI', (input) => {
    expect(() => readMediaPromotionMongoSettings(input)).toThrow();
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts explicit loopback %s',
    (host) => {
      const local = `mongodb://${host}:27018/?replicaSet=animalrecord_test&directConnection=true`;
      expect(
        readMediaPromotionMongoSettings({
          ...env,
          MEDIA_PROMOTION_MONGO_TEST_URI: local,
        }),
      ).toEqual({ uri: local, replicaSet: 'animalrecord_test' });
    },
  );

  it.each([
    'mongodb://remote.example:27018/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    'mongodb+srv://remote.example/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&replicaSet=other',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=false',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&authSource=admin',
    'mongodb://127.0.0.1:27018,localhost:27019/?replicaSet=rs0',
    'mongodb://127.0.0.1/?replicaSet=rs0',
    'mongodb://127.0.0.1:80/?replicaSet=rs0',
    ` ${uri}`,
    `${uri}\n`,
  ])('rejects unsafe or ambiguous URI without echoing it', (invalid) => {
    expect(() =>
      readMediaPromotionMongoSettings({
        ...env,
        MEDIA_PROMOTION_MONGO_TEST_URI: invalid,
      }),
    ).toThrow('Integration URI');
    try {
      readMediaPromotionMongoSettings({
        ...env,
        MEDIA_PROMOTION_MONGO_TEST_URI: invalid,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(invalid);
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('generates independent frozen namespaces within the Mongo database-name limit', () => {
    const first = createPromotionTestNamespace(),
      second = createPromotionTestNamespace();
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(first.databaseName).toMatch(
      /^animalrecord_promotion_test_[a-f0-9]{32}$/,
    );
    expect(Buffer.byteLength(first.databaseName)).toBeLessThan(64);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() =>
      assertOwnedPromotionTestDatabase(first, first.databaseName, first.runId, [
        ...PROMOTION_TEST_COLLECTIONS,
      ]),
    ).not.toThrow();
    // Partial setup is cleanable only with its own marker and allowed subset.
    expect(() =>
      assertOwnedPromotionTestDatabase(first, first.databaseName, first.runId, [
        WRITE_TEST_MARKER,
      ]),
    ).not.toThrow();
  });

  it.each([
    'database',
    'marker',
    'missing-marker',
    'extra',
    'namespace',
    'runId',
  ])('refuses cleanup with a mismatching %s', (field) => {
    const n = createPromotionTestNamespace();
    expect(() =>
      assertOwnedPromotionTestDatabase(
        field === 'namespace'
          ? {
              ...n,
              databaseName:
                'animalrecord_write_test_' + n.runId.replace(/-/g, ''),
            }
          : field === 'runId'
            ? { ...n, runId: 'not-a-uuid' }
            : n,
        field === 'database' ? 'animalrecord' : n.databaseName,
        field === 'marker' ? 'someone-else' : n.runId,
        field === 'missing-marker'
          ? []
          : field === 'extra'
            ? [...PROMOTION_TEST_COLLECTIONS, 'animals']
            : [...PROMOTION_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });

  it('does not expand previous cleanup allowlists or permit unrelated collections', () => {
    expect(WRITE_TEST_COLLECTIONS).toEqual([
      WRITE_TEST_MARKER,
      'animal_ownership_controls',
      'animal_write_journals',
    ]);
    expect(EVIDENCE_TEST_COLLECTIONS).not.toContain(
      'animal_media_promotion_records',
    );
    expect(PROMOTION_TEST_COLLECTIONS).toHaveLength(5);
    for (const name of [
      'animals',
      'animal_ownership_periods',
      '_synthetic_joint_writes',
      'medical_documents',
    ]) {
      const n = createPromotionTestNamespace();
      expect(() =>
        assertOwnedPromotionTestDatabase(n, n.databaseName, n.runId, [
          WRITE_TEST_MARKER,
          name,
        ]),
      ).toThrow('cleanup refused');
    }
  });

  it.each([
    {
      uri: 'mongodb://remote.example:27018/?replicaSet=rs0',
      replicaSet: 'rs0',
    },
    { uri, replicaSet: 'different' },
  ])(
    'rejects invalid direct fixture settings before creating any connection',
    async (settings) => {
      const spy = jest
        .spyOn(mongoose, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Unexpected connection attempt');
        });
      const fixture = new MediaPromotionMongoFixture();
      try {
        await expect(fixture.open(settings)).rejects.toThrow();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        await fixture.close();
        spy.mockRestore();
      }
    },
  );

  it('discovers exactly its own integration suite, separately from ordinary Jest and older commands', () => {
    const names = [
      'media-promotion-persistence',
      'animal-write-protocol',
      'archive-evidence-consumption',
      'archive-projection-read',
    ];
    const configs = [
      'media-promotion',
      'animal-write',
      'archive-evidence',
      'archive-projection',
    ];
    for (const [i, name] of configs.entries()) {
      const config = JSON.parse(
        readFileSync(
          resolve(__dirname, `../../jest-${name}-mongo.json`),
          'utf8',
        ),
      ) as { testRegex: string; globalSetup: string };
      expect(
        names.map((n) =>
          new RegExp(config.testRegex).test(`${n}.mongo.integration.ts`),
        ),
      ).toEqual(names.map((_, j) => i === j));
      if (i === 0)
        expect(config.globalSetup).toContain(
          'require-media-promotion-mongo.ts',
        );
    }
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { jest: { testRegex: string }; scripts: Record<string, string> };
    for (const name of names)
      expect(
        new RegExp(pkg.jest.testRegex).test(`${name}.mongo.integration.ts`),
      ).toBe(false);
    expect(pkg.scripts['test:integration:media-promotion']).toContain(
      'jest-media-promotion-mongo.json',
    );
    expect(pkg.scripts['test:integration:media-promotion:check']).toContain(
      'tsc --project',
    );
  });

  it('pauses once, releases and lets retry proceed without fabricating results', async () => {
    const gate = new PromotionRaceGate(),
      pause = gate.arm('JOURNAL_FENCE');
    expect(() => gate.arm('GATE_WRITE')).toThrow('already armed');
    const pending = gate.before('JOURNAL_FENCE');
    await pause.entered();
    pause.release();
    await pending;
    await gate.before('JOURNAL_FENCE');
    expect(gate.counts.JOURNAL_FENCE).toBe(2);
    const second = gate.arm('GATE_WRITE');
    const draining = gate.before('GATE_WRITE');
    await second.entered();
    gate.releaseAll();
    await draining;
  });
});
