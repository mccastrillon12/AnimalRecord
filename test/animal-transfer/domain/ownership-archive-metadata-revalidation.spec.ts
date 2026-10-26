import {
  ArchiveMetadataRevalidation,
  ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
  assertMetadataRevalidation,
  metadataRevalidationDefinition,
} from '../../../src/context/animal-transfer/domain/ownership-archive-metadata-revalidation';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { metadataRevalidationFixture } from '../fixtures/ownership-archive-metadata-revalidation.fixture';
import { historyUuid } from '../fixtures/ownership-archive-history.fixture';

describe('Metadata observation is not commit authority', () => {
  const setup = () => {
    const s = metadataRevalidationFixture();
    const id = historyUuid(800);
    const run: ArchiveMetadataRevalidation = {
      protocol: ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
      id,
      archiveId: s.archive.id,
      definitionHash: metadataRevalidationDefinition(id, s.archive),
      phase: 'ENTRIES',
      revision: 0,
      controlRevision: 41,
      reservationHash: archiveHash(s.control.transferLock),
      entryCount: 0,
      fileCount: 0,
      entryDigest: s.initialDigest,
      fileDigest: s.initialDigest,
      startedAt: '2026-10-25T12:30:00.000Z',
    };
    return { ...s, run };
  };
  it('pins protocol, archive plan/materialization/counts and explicit run identity', () => {
    const s = setup();
    expect(() => assertMetadataRevalidation(s.run, s.archive)).not.toThrow();
    expect(metadataRevalidationDefinition(s.run.id, s.archive)).toBe(
      s.run.definitionHash,
    );
    expect(
      metadataRevalidationDefinition(historyUuid(801), s.archive),
    ).not.toBe(s.run.definitionHash);
    s.archive.referencePlan!.revision++;
    expect(() => assertMetadataRevalidation(s.run, s.archive)).toThrow();
  });
  it.each([
    'definition',
    'negative count',
    'overflow count',
    'bad cursor',
    'missing cursor',
    'unexpected cursor',
    'empty digest',
    'control revision',
    'phase',
    'timestamp',
    'premature observedAt',
  ])('rejects %s', (problem) => {
    const s = setup();
    if (problem === 'definition') s.run.definitionHash = 'bad';
    if (problem === 'negative count') s.run.entryCount = -1;
    if (problem === 'overflow count') s.run.fileCount = 100;
    if (problem === 'bad cursor') {
      s.run.entryCount = 1;
      s.run.entryAfterId = '../id';
    }
    if (problem === 'missing cursor') s.run.entryCount = 1;
    if (problem === 'unexpected cursor') s.run.entryAfterId = 'a'.repeat(64);
    if (problem === 'empty digest') s.run.entryDigest = 'x';
    if (problem === 'control revision') s.run.controlRevision = 0;
    if (problem === 'phase') Object.assign(s.run, { phase: 'READY_TO_COMMIT' });
    if (problem === 'timestamp') s.run.startedAt = 'invalid';
    if (problem === 'premature observedAt') s.run.observedAt = s.run.startedAt;
    expect(() => assertMetadataRevalidation(s.run, s.archive)).toThrow();
  });
  it('does not accept FILES/terminal phases with omitted entries or files', () => {
    const s = setup();
    s.run.phase = 'FILES';
    expect(() => assertMetadataRevalidation(s.run, s.archive)).toThrow();
    s.run.entryCount = s.entries.length;
    s.run.entryAfterId = s.entries[s.entries.length - 1].id;
    s.run.phase = 'METADATA_OBSERVED';
    s.run.observedAt = s.run.startedAt;
    expect(() => assertMetadataRevalidation(s.run, s.archive)).toThrow();
    s.run.fileCount = s.files.length;
    s.run.fileAfterId = s.files[s.files.length - 1].id;
    expect(() => assertMetadataRevalidation(s.run, s.archive)).not.toThrow();
    expect(s.run).not.toHaveProperty('canCommit');
    expect(s.run).not.toHaveProperty('s3VerifiedAt');
  });
});
