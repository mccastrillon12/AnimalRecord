import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readArchiveProjectionMongoSettings } from '../integration/support/archive-projection-mongo-safety';

const uri = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test';
const env = {
  ARCHIVE_PROJECTION_MONGO_TESTS: '1',
  ARCHIVE_PROJECTION_MONGO_TEST_URI: uri,
};

describe('Projection Mongo harness opt-in and discovery (no connections)', () => {
  it.each([
    {},
    { MONGO_URI: uri },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { ARCHIVE_EVIDENCE_MONGO_TESTS: '1', ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri },
    { ...env, ARCHIVE_PROJECTION_MONGO_TESTS: '0' },
    { ARCHIVE_PROJECTION_MONGO_TESTS: '1' },
  ])('requires its own explicit opt-in and URI', (input) => {
    expect(() => readArchiveProjectionMongoSettings(input)).toThrow();
  });
  it('never falls back to app or older harness URIs even when its own opt-in is present', () => {
    expect(() =>
      readArchiveProjectionMongoSettings({
        ARCHIVE_PROJECTION_MONGO_TESTS: '1',
        MONGO_URI: uri,
        ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri,
        ANIMAL_WRITE_MONGO_TEST_URI: uri,
      }),
    ).toThrow('Integration URI');
  });
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts a dedicated explicit loopback endpoint (%s)',
    (host) => {
      const local = `mongodb://${host}:27018/?replicaSet=animalrecord_test&directConnection=true`;
      expect(
        readArchiveProjectionMongoSettings({
          ...env,
          ARCHIVE_PROJECTION_MONGO_TEST_URI: local,
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
  ])('rejects ambiguous/unsafe URIs without echoing them', (invalid) => {
    try {
      readArchiveProjectionMongoSettings({
        ...env,
        ARCHIVE_PROJECTION_MONGO_TEST_URI: invalid,
      });
      throw new Error('Expected URI rejection');
    } catch (error) {
      expect((error as Error).message).toContain('Integration URI');
      expect((error as Error).message).not.toContain(invalid);
      expect((error as Error).message).not.toContain('secret');
    }
  });
  it('keeps all three Mongo suites explicitly separated and outside ordinary Jest discovery', () => {
    const config = (file: string) =>
      JSON.parse(readFileSync(resolve(__dirname, '../../', file), 'utf8')) as {
        testRegex: string;
        globalSetup: string;
      };
    const projection = config('jest-archive-projection-mongo.json');
    const evidence = config('jest-archive-evidence-mongo.json');
    const writes = config('jest-animal-write-mongo.json');
    const files = [
      'archive-projection-read.mongo.integration.ts',
      'archive-evidence-consumption.mongo.integration.ts',
      'animal-write-protocol.mongo.integration.ts',
    ];
    for (const [i, entry] of [projection, evidence, writes].entries())
      expect(
        files.map((file) => new RegExp(entry.testRegex).test(file)),
      ).toEqual(files.map((_, index) => index === i));
    expect(projection.globalSetup).toContain(
      'require-archive-projection-mongo.ts',
    );
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { jest: { testRegex: string }; scripts: Record<string, string> };
    expect(new RegExp(pkg.jest.testRegex).test(files[0])).toBe(false);
    expect(pkg.scripts['test:integration:archive-projection']).toContain(
      'jest-archive-projection-mongo.json',
    );
    expect(pkg.scripts['test:integration:archive-evidence']).toContain(
      'jest-archive-evidence-mongo.json',
    );
  });
});
