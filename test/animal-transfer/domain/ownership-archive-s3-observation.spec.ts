import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  advanceS3Observation,
  assertS3Observation,
  assertS3ObservationItem,
  s3ObservationMetadataHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';
import { s3ObservationFixture } from '../fixtures/ownership-archive-s3-observation.fixture';
import { historyClone as clone } from '../fixtures/ownership-archive-history.fixture';

describe('S3 observation evidence is bounded and tied to the metadata manifest', () => {
  it('matches the exact metadata manifest and pins observation digest without mutating the page', () => {
    const s = s3ObservationFixture();
    const before = clone(s.run);
    const next = advanceS3Observation(s.run, s.items, s.receipts, 5);
    expect(next.phase).toBe('S3_OBSERVED');
    expect(next.count).toBe(s.run.fileCount);
    expect(next.manifestDigest).toBe(s.run.fileDigest);
    expect(next.observationDigest).not.toBe(archiveHash([]));
    expect(s.run).toEqual(before);
    expect(next).not.toHaveProperty('canCommit');
  });
  it('supports exact-full/empty final pages and digests independent of batch size', () => {
    const s = s3ObservationFixture();
    const first = advanceS3Observation(
      s.run,
      s.items.slice(0, 1),
      s.receipts.slice(0, 1),
      1,
    );
    const second = advanceS3Observation(
      { ...s.run, s3Observation: first },
      s.items.slice(1),
      s.receipts.slice(1),
      1,
    );
    expect(second.phase).toBe('OBSERVING');
    const final = advanceS3Observation(
      { ...s.run, s3Observation: second },
      [],
      [],
      1,
    );
    const onePage = advanceS3Observation(s.run, s.items, s.receipts, 5);
    expect(final.observationDigest).toBe(onePage.observationDigest);
    expect(final.phase).toBe('S3_OBSERVED');
  });
  it('handles empty manifests without inventing remote observations', () => {
    const s = s3ObservationFixture(0, false);
    const next = advanceS3Observation(s.run, [], [], 5);
    expect(next.phase).toBe('S3_OBSERVED');
    expect(next.count).toBe(0);
    expect(next.observationDigest).toBe(archiveHash([]));
  });
  it.each([
    'missing receipt',
    'different revision',
    'different sha',
    'duplicate receipt',
    'wrong order',
    'changed manifest',
    'changed metadata',
    'not complete metadata',
    'terminal reused',
    'oversize page',
  ])('rejects %s', (problem) => {
    const s = s3ObservationFixture();
    if (problem === 'missing receipt') s.receipts.pop();
    if (problem === 'different revision') s.receipts[0].revision.etag = 'other';
    if (problem === 'different sha') s.receipts[0].sha256 = 'c'.repeat(64);
    if (problem === 'duplicate receipt') s.receipts[1] = clone(s.receipts[0]);
    if (problem === 'wrong order') {
      s.items.reverse();
      s.receipts.reverse();
    }
    if (problem === 'changed manifest') {
      s.run.fileDigest = 'd'.repeat(64);
      s.run.s3Observation!.metadataHash = s3ObservationMetadataHash(s.run);
    }
    if (problem === 'changed metadata') s.run.entryDigest = 'd'.repeat(64);
    if (problem === 'not complete metadata') s.run.phase = 'FILES';
    if (problem === 'terminal reused')
      s.run.s3Observation = advanceS3Observation(s.run, s.items, s.receipts, 5);
    expect(() =>
      advanceS3Observation(
        s.run,
        s.items,
        s.receipts,
        problem === 'oversize page' ? 1 : 5,
      ),
    ).toThrow();
  });
  it('does not accept an incomplete set even if all provided receipts match', () => {
    const s = s3ObservationFixture();
    expect(() =>
      advanceS3Observation(
        s.run,
        s.items.slice(0, 1),
        s.receipts.slice(0, 1),
        5,
      ),
    ).toThrow();
  });
  it.each(['file', 'protocol', 'registration', 'version'])(
    'rejects malformed work %s before storage',
    (problem) => {
      const item = s3ObservationFixture().items[0];
      if (problem === 'file') item.fileId = 'wrong';
      if (problem === 'protocol')
        item.intent.protocol = 'ARCHIVE_MATERIALIZATION_V1';
      if (problem === 'registration') item.registrationDefinitionHash += '\n';
      if (problem === 'version') item.revision.versionId = '';
      expect(() => assertS3ObservationItem(item)).toThrow();
    },
  );
  it('rejects malformed progress and does not equate phase with current remote availability', () => {
    const s = s3ObservationFixture();
    s.run.s3Observation!.count = -1;
    expect(() => assertS3Observation(s.run)).toThrow();
    s.run.s3Observation!.count = 0;
    s.run.s3Observation!.afterId = 'a'.repeat(64);
    expect(() => assertS3Observation(s.run)).toThrow();
  });
});
