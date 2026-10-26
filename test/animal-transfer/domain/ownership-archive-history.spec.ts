import { buildRetainedArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  archiveAnimal,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';
import {
  historyArchive,
  historyClone,
  historyKeyFromUrl,
  historyRecord,
} from '../fixtures/ownership-archive-history.fixture';

describe('Retained dossier provenance', () => {
  const setup = () => {
    const source = historyArchive(1);
    const destination = historyArchive(2);
    const doc = archiveMedicalDocument();
    const original = historyRecord(source, {
      kind: 'MEDICAL_DOCUMENT',
      data: doc,
    });
    const build = () =>
      buildRetainedArchiveEntry(
        destination,
        source,
        original.entry,
        original.files,
        historyKeyFromUrl,
      );
    return { source, destination, original, doc, build };
  };

  it('preserves names, codes, first acceptance, clinical data and original payload without rebinding active URLs', () => {
    const { original, doc, source, build } = setup();
    const result = build();
    expect(result.entry.kind).toBe('RETAINED_RECORD');
    expect(result.entry.payload).toEqual(doc);
    expect(result.entry.retained).toMatchObject({
      kind: 'MEDICAL_DOCUMENT',
      resourceId: doc.id,
      ownerId: source.ownerId,
      periodId: source.periodId,
      rootArchiveId: source.id,
      rootEntryId: original.entry.id,
    });
    expect(result.files).toHaveLength(1);
    expect(result.entry.fileBindings[0].fileId).toBe(
      result.entry.fileBindings[1].fileId,
    );
    expect(result.files[0].sourceKey).toBe(original.files[0].historicalKey);
    expect(result.files[0].source).toEqual(
      original.files[0].verified!.historical,
    );
    expect(result.files[0].retained!.sha256).toBe(
      original.files[0].verified!.sha256,
    );
    doc.description = 'later edit';
    original.entry.payload.acceptedAt = 'later date';
    expect(result.entry.payload.description).toBeUndefined();
    expect(result.entry.payload.acceptedAt).toBe('2026-10-25T10:00:00.000Z');
  });

  it('A→B→C→A carries replaced/deleted snapshots with a stable root and no nested path growth or return collision', () => {
    const { source, destination, original, build } = setup();
    const atB = build();
    atB.files.forEach((file) => {
      file.state = 'VERIFIED';
      file.verified = historyClone(original.files[0].verified!);
    });
    const c = historyArchive(3, 3, 1);
    const atC = buildRetainedArchiveEntry(
      c,
      destination,
      atB.entry,
      atB.files,
      historyKeyFromUrl,
    );
    expect(atC.entry.retained!.rootEntryId).toBe(original.entry.id);
    expect(atC.entry.retained!.sourceEntryId).toBe(atB.entry.id);
    expect(atC.entry.resourceId).toBe(atB.entry.resourceId);
    expect(atC.files[0].relativeKey).toBe(atB.files[0].relativeKey);
    expect(atC.files[0].recipientFinalKey).toContain(
      `users/${source.ownerId}/animals/${source.animalId}/retained-history/`,
    );
    expect(atC.files[0].recipientFinalKey).not.toBe(
      original.files[0].sourceKey,
    );
    expect(atC.files[0].recipientFinalKey).not.toBe(
      original.files[0].historicalKey,
    );
    expect(atC.entry.payload).toEqual(original.entry.payload);
    // Current replacement of the same document is a separate snapshot, never an overwrite.
    const replacement = archiveMedicalDocument();
    replacement.ownerId = destination.ownerId;
    replacement.storageKey = replacement.storageKey.replace(
      source.ownerId,
      destination.ownerId,
    );
    replacement.documentLocations![0].storageKey = replacement.storageKey;
    const live = historyRecord(destination, {
      kind: 'MEDICAL_DOCUMENT',
      data: replacement,
    });
    expect(live.entry.id).not.toBe(atB.entry.id);
    expect(live.entry.resourceId).toBe(atB.entry.retained!.resourceId);
  });

  it('retains historical animal names separately from the current profile', () => {
    const source = historyArchive(1);
    const destination = historyArchive(2);
    const original = historyRecord(source, {
      kind: 'ANIMAL',
      data: archiveAnimal,
    });
    const result = buildRetainedArchiveEntry(
      destination,
      source,
      original.entry,
      [],
      historyKeyFromUrl,
    );
    expect(result.entry.payload.nameHistory).toEqual(archiveAnimal.nameHistory);
    expect(result.entry.kind).not.toBe('ANIMAL');
  });

  it.each([
    'hash',
    'foreign archive',
    'unverified',
    'missing binding',
    'bad digest',
    'path traversal',
    'changed definition',
    'wrong historical namespace',
  ])('fails closed on %s', (caseName) => {
    const { original, build } = setup();
    if (caseName === 'hash') original.entry.payload.description = 'corrupted';
    if (caseName === 'foreign archive')
      original.files[0].archiveId = historyArchive(3).id;
    if (caseName === 'unverified') original.files[0].state = 'PENDING';
    if (caseName === 'missing binding') original.files.length = 0;
    if (caseName === 'bad digest')
      original.files[0].verified!.sha256 = 'not-a-digest';
    if (caseName === 'path traversal')
      original.files[0].relativeKey = '../source.pdf';
    if (caseName === 'changed definition')
      original.files[0].source.etag = 'changed';
    if (caseName === 'wrong historical namespace')
      original.files[0].historicalKey = original.files[0].recipientStagingKey;
    expect(build).toThrow('provenance or integrity');
  });

  it('does not allow retained-history keys through the live-source builder', () => {
    const source = historyArchive(1);
    const data = {
      ...archiveAnimal,
      profilePictureUrl: `https://test/users/${source.ownerId}/animals/${source.animalId}/retained-history/a/file.jpg`,
    };
    expect(() => historyRecord(source, { kind: 'ANIMAL', data })).toThrow(
      'cannot be used as a live',
    );
  });

  it('checks entry identity as well as payload hash', () => {
    const { original, build } = setup();
    original.entry.id = archiveHash('wrong record');
    expect(build).toThrow('provenance or integrity');
  });
});
