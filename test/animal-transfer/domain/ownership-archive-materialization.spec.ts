import {
  assertArchiveMaterialization,
  assertMaterializationIntent,
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { materializationFixture } from '../fixtures/ownership-archive-materialization.fixture';

describe('Materialization identities', () => {
  it('pins staging revision, destination and digest independently of work leases', () => {
    const s = materializationFixture();
    expect(s.intent.sourceKey).toBe(s.file.recipientStagingKey);
    expect(s.intent.source).toEqual(s.file.verified!.recipientStaging);
    expect(s.intent.destinationKey).toBe(s.file.recipientFinalKey);
    expect(s.intent).not.toHaveProperty('leaseToken');
    expect(s.intent).not.toHaveProperty('payload');
    expect(
      buildArchiveMaterializationIntent(
        s.archive,
        s.file,
        s.entry.referencePlan!,
      ),
    ).toEqual(s.intent);
    s.file.verified!.recipientStaging.etag = 'later mutation';
    expect(s.intent.source.etag).toBe('staging');
  });
  it.each([
    'not planned',
    'header identity',
    'file identity',
    'plan identity',
    'destination',
    'digest',
    'unverified',
  ])('rejects %s', (problem) => {
    const s = materializationFixture();
    if (problem === 'not planned') s.archive.referencePlan!.phase = 'PLANNING';
    if (problem === 'header identity')
      s.archive.materialization!.definitionHash = 'changed';
    if (problem === 'file identity') s.file.definitionHash = 'changed';
    if (problem === 'plan identity')
      s.entry.referencePlan!.planHash = 'changed';
    if (problem === 'destination') s.file.recipientFinalKey = s.file.sourceKey;
    if (problem === 'digest') s.file.verified!.sha256 += '\n';
    if (problem === 'unverified') s.file.state = 'PENDING';
    expect(() =>
      buildArchiveMaterializationIntent(
        s.archive,
        s.file,
        s.entry.referencePlan!,
      ),
    ).toThrow();
  });
  it('does not change READY or authorize reference activation', () => {
    const s = materializationFixture();
    expect(buildArchiveMaterialization(s.archive).phase).toBe('MATERIALIZING');
    expect(s.archive.state).toBe('READY');
    s.archive.materialization!.phase = 'MATERIALIZED';
    expect(() => assertArchiveMaterialization(s.archive)).not.toThrow();
  });
  it('rejects foreign destination paths even when a caller recalculates the intent hash', () => {
    const s = materializationFixture();
    const { definitionHash: _hash, ...definition } = s.intent;
    expect(_hash).toHaveLength(64);
    const invalid = { ...definition, destinationKey: s.file.historicalKey };
    expect(() =>
      assertMaterializationIntent({
        ...invalid,
        definitionHash: archiveHash(invalid),
      }),
    ).toThrow();
  });
});
