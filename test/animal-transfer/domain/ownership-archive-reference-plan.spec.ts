import {
  ArchiveEntry,
  OwnershipArchive,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildArchiveEntryReferencePlan } from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { buildRetainedArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import {
  archiveAnimal,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';
import {
  historyArchive,
  historyClone as clone,
  historyKeyFromUrl,
  historyRecord,
} from '../fixtures/ownership-archive-history.fixture';

const ready = (
  archive: OwnershipArchive,
  entries = 1,
  files = 1,
): OwnershipArchive => ({
  ...archive,
  state: 'READY',
  expectedEntryCount: entries,
  expectedFileCount: files,
  ...(archive.ownershipVersion > 1
    ? {
        history: {
          sourceArchiveId: historyArchive(archive.ownershipVersion - 1).id,
          sourceDefinitionHash: 'a'.repeat(64),
          expectedEntryCount: 1,
          expectedFileCount: 1,
          entryCount: 1,
          revision: 1,
          phase: 'COMPLETE' as const,
        },
      }
    : {}),
});
const rehash = (entry: ArchiveEntry) => {
  entry.contentHash = archiveHash({
    kind: entry.kind,
    payload: entry.payload,
    fileBindings: entry.fileBindings,
    ...(entry.retained ? { retained: entry.retained } : {}),
  });
};

describe('Archive reference plans are instructions, not activation', () => {
  const setup = () => {
    const archive = ready(historyArchive(1));
    const record = historyRecord(archive, {
      kind: 'MEDICAL_DOCUMENT',
      data: archiveMedicalDocument(),
    });
    const build = () =>
      buildArchiveEntryReferencePlan(
        archive,
        record.entry,
        record.files,
        historyKeyFromUrl,
      );
    return { archive, ...record, build };
  };
  it('plans both medical keys without changing clinical owner data, codes, version or first acceptance', () => {
    const s = setup();
    const before = clone(s.entry);
    const plan = s.build();
    expect(plan.ownerChange).toEqual({
      from: s.archive.ownerId,
      to: s.archive.recipientId,
    });
    expect(plan.mode).toBe('LIVE_RESOURCE');
    expect(plan.bindings.map((b) => b.path)).toEqual([
      '/storageKey',
      '/documentLocations/0/storageKey',
    ]);
    expect(plan.bindings.every((b) => b.format === 'KEY')).toBe(true);
    expect(plan.bindings[0].fileId).toBe(plan.bindings[1].fileId);
    expect(plan.bindings[0].recipient.plannedFinalKey).toBe(
      s.files[0].recipientFinalKey,
    );
    expect(plan.bindings[0].recipient).not.toHaveProperty('finalRevision');
    expect(plan).not.toHaveProperty('payload');
    expect(s.entry).toEqual(before);
    expect(s.build()).toEqual(plan);
    s.files[0].verified!.historical.etag = 'mutated after build';
    expect(plan.bindings[0].historical.revision.etag).toBe('history');
  });

  it('plans profile and diary references as URLs without generating URLs or changing nameHistory', () => {
    const archive = ready(historyArchive(1));
    const key = `users/${archive.ownerId}/animals/${archive.animalId}/profile_123.jpg`;
    const animal = {
      ...archiveAnimal,
      profilePictureUrl: `https://test/${key}`,
    };
    const profile = historyRecord(archive, { kind: 'ANIMAL', data: animal });
    const profilePlan = buildArchiveEntryReferencePlan(
      archive,
      profile.entry,
      profile.files,
      historyKeyFromUrl,
    );
    expect(profilePlan.bindings[0]).toMatchObject({
      path: '/profilePictureUrl',
      format: 'URL',
    });
    expect(profile.entry.payload.nameHistory).toEqual(animal.nameHistory);
    const diary = historyRecord(archive, {
      kind: 'DIARY_ENTRY',
      data: {
        id: 'diary',
        animalId: archive.animalId,
        title: 'audio',
        content: 'text',
        date: '2020-01-01',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        attachments: [
          {
            id: 'audio',
            url: `https://test/users/${archive.ownerId}/animals/${archive.animalId}/diary/diary/audio.mp3`,
            fileName: 'audio.mp3',
            mimeType: 'audio/mpeg',
            size: 12,
            fileType: 'audio',
            createdAt: '2026-01-01',
          },
        ],
      },
    });
    const plan = buildArchiveEntryReferencePlan(
      archive,
      diary.entry,
      diary.files,
      historyKeyFromUrl,
    );
    expect(plan.bindings[0]).toMatchObject({
      path: '/attachments/0/url',
      format: 'URL',
    });
    expect(plan.ownerChange).toBeUndefined();
  });

  it('A→B→C→A keeps historical identity/read-only provenance and collision-free planned keys', () => {
    const a = setup();
    const b = ready(historyArchive(2), 2, 2);
    const inheritedB = buildRetainedArchiveEntry(
      b,
      a.archive,
      a.entry,
      a.files,
      historyKeyFromUrl,
    );
    inheritedB.files.forEach((file) => {
      file.state = 'VERIFIED';
      file.verified = clone(a.files[0].verified!);
    });
    const c = ready(historyArchive(3, 3, 1), 3, 3);
    const inheritedC = buildRetainedArchiveEntry(
      c,
      b,
      inheritedB.entry,
      inheritedB.files,
      historyKeyFromUrl,
    );
    inheritedC.files.forEach((file) => {
      file.state = 'VERIFIED';
      file.verified = clone(a.files[0].verified!);
    });
    const plan = buildArchiveEntryReferencePlan(
      c,
      inheritedC.entry,
      inheritedC.files,
      historyKeyFromUrl,
    );
    expect(plan.mode).toBe('RETAINED_READ_ONLY');
    expect(plan.ownerChange).toBeUndefined();
    expect(inheritedC.entry.payload.ownerId).toBe(a.archive.ownerId);
    expect(inheritedC.entry.payload.acceptedAt).toBe(
      a.entry.payload.acceptedAt,
    );
    expect(plan.bindings[0].recipient.plannedFinalKey).toContain(
      `users/${a.archive.ownerId}/animals/${a.archive.animalId}/retained-history/`,
    );
    expect(plan.bindings[0].recipient.plannedFinalKey).not.toBe(
      a.files[0].sourceKey,
    );
    expect(plan.bindings[0].recipient.plannedFinalKey).not.toBe(
      a.files[0].historicalKey,
    );
  });

  it.each([
    'prototype path',
    'unexpected path',
    'missing binding',
    'duplicated binding',
    'changed payload',
    'wrong entry',
    'foreign file',
    'wrong final',
    'wrong staging',
    'unverified file',
    'missing file',
    'extra file',
    'wrong digest',
    'wrong revision size',
  ])('fails closed on %s', (problem) => {
    const s = setup();
    if (problem === 'prototype path') {
      s.entry.fileBindings[0].path = '/__proto__/polluted';
      rehash(s.entry);
    }
    if (problem === 'unexpected path') {
      s.entry.fileBindings[0].path = '/validatedExtraction/owner/name';
      rehash(s.entry);
    }
    if (problem === 'missing binding') {
      s.entry.fileBindings.pop();
      rehash(s.entry);
    }
    if (problem === 'duplicated binding') {
      s.entry.fileBindings.push(clone(s.entry.fileBindings[0]));
      rehash(s.entry);
    }
    if (problem === 'changed payload')
      s.entry.payload.description = 'later edit';
    if (problem === 'wrong entry') s.entry.id = archiveHash('other');
    if (problem === 'foreign file') s.files[0].archiveId = historyArchive(2).id;
    if (problem === 'wrong final')
      s.files[0].recipientFinalKey = s.files[0].sourceKey;
    if (problem === 'wrong staging')
      s.files[0].recipientStagingKey = s.files[0].historicalKey;
    if (problem === 'unverified file') s.files[0].state = 'PENDING';
    if (problem === 'missing file') s.files.length = 0;
    if (problem === 'extra file')
      s.files.push({ ...s.files[0], id: archiveHash('extra') });
    if (problem === 'wrong digest') s.files[0].verified!.sha256 = 'bad';
    if (problem === 'wrong revision size')
      s.files[0].verified!.recipientStaging.size++;
    expect(s.build).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    'not ready',
    'definition hash',
    'incomplete capture',
    'incomplete history',
  ])('rejects %s archives', (problem) => {
    const s = setup();
    if (problem === 'not ready') s.archive.state = 'COPYING';
    if (problem === 'definition hash') s.archive.definitionHash = 'wrong';
    if (problem === 'incomplete capture')
      s.archive.capture = { revision: 1, entryCount: 1, phase: 'MEDICAL' };
    if (problem === 'incomplete history')
      s.archive.history = {
        sourceArchiveId: 'previous',
        sourceDefinitionHash: 'hash',
        expectedEntryCount: 1,
        expectedFileCount: 0,
        entryCount: 0,
        revision: 0,
        phase: 'IMPORTING',
      };
    expect(s.build).toThrow('complete READY archive');
  });
});
