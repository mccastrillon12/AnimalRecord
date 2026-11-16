import {
  ArchiveEntry,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildArchiveRecipientProjection } from '../../../src/context/animal-transfer/domain/ownership-archive-recipient-projection';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';
import { metadataRevalidationFixture } from '../fixtures/ownership-archive-metadata-revalidation.fixture';
import {
  projectionUrls,
  recipientProjectionFixture,
} from '../fixtures/ownership-archive-recipient-projection.fixture';

function project(s = recipientProjectionFixture(), urls = projectionUrls) {
  return buildArchiveRecipientProjection(
    s.archive,
    s.entries,
    s.files,
    s.registrations,
    urls,
  );
}
function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
}
const rehash = (entry: ArchiveEntry) => {
  entry.contentHash = archiveHash({
    kind: entry.kind,
    payload: entry.payload,
    fileBindings: entry.fileBindings,
    ...(entry.retained ? { retained: entry.retained } : {}),
  });
};

describe('Pure recipient projection, never an activation or access grant', () => {
  it('projects profile, diary and medical references to verified generations while preserving opaque data', () => {
    const s = recipientProjectionFixture();
    const before = clone(s);
    deepFreeze(s);
    const result = project(s);
    expect(s).toEqual(before);
    expect(result.definition).toMatchObject({
      animalId: s.archive.animalId,
      recipientId: s.archive.recipientId,
    });
    expect(result.media).toHaveLength(s.files.length);
    for (const entry of result.entries) {
      const original = s.entries.find((e) => e.id === entry.entryId)!;
      const expected = clone(original.payload);
      if (original.kind === 'ANIMAL' || original.kind === 'MEDICAL_DOCUMENT')
        expected.ownerId = s.archive.recipientId;
      if (original.kind === 'ANIMAL')
        expected.profilePictureUrl = projectionUrls.urlForKey(
          result.media.find((m) => m.fileId === entry.references[0].fileId)!
            .key,
        );
      if (original.kind === 'DIARY_ENTRY')
        (expected.attachments as Array<{ url: string }>).forEach((item, i) => {
          item.url = projectionUrls.urlForKey(
            result.media.find((m) => m.fileId === entry.references[i].fileId)!
              .key,
          );
        });
      if (original.kind === 'MEDICAL_DOCUMENT') {
        const key = result.media.find(
          (m) => m.fileId === entry.references[0].fileId,
        )!.key;
        expected.storageKey = key;
        (
          expected.documentLocations as Array<{ storageKey: string }>
        )[0].storageKey = key;
        expect(entry.references[0].registrationId).toBe(
          entry.references[1].registrationId,
        );
        expect(entry.payload).toMatchObject({
          documentCode: original.payload.documentCode,
          acceptedAt: original.payload.acceptedAt,
          finalCategory: original.payload.finalCategory,
          validatedExtraction: original.payload.validatedExtraction,
        });
      }
      expect(entry.payload).toEqual(expected);
      expect(entry.sourceContentHash).toBe(original.contentHash);
      expect(entry.sourcePlanHash).toBe(original.referencePlan!.planHash);
    }
    for (const media of result.media) {
      const file = s.files.find((file) => file.id === media.fileId)!;
      expect(media.key).toBe(file.materialization!.intent.destinationKey);
      expect(media.key).not.toBe(file.recipientFinalKey);
      expect(media.key).not.toBe(file.recipientStagingKey);
      expect(media.state).toBe('PREPARED');
    }
    expect(result).not.toHaveProperty('canCommit');
    expect(result).not.toHaveProperty('consumption');
  });
  it.each([false, true])(
    'keeps retained identity/owner/provenance read-only, including return to A (%s)',
    (returning) => {
      const s = recipientProjectionFixture(true, returning);
      const result = project(s);
      const original = s.entries.find((e) => e.kind === 'RETAINED_RECORD')!;
      const retained = result.entries.find(
        (e) => e.kind === 'RETAINED_RECORD',
      )!;
      expect(retained.mode).toBe('RETAINED_READ_ONLY');
      expect(retained.retained).toEqual(original.retained);
      expect(retained.payload.ownerId).toBe(original.payload.ownerId);
      expect(retained.resourceId).toBe(original.resourceId);
      expect(retained.sourceKind).toBe('MEDICAL_DOCUMENT');
      expect(retained.payload.storageKey).toBe(
        result.media.find((m) => m.fileId === retained.references[0].fileId)!
          .key,
      );
      expect(
        result.media.filter((m) => m.mode === 'RETAINED_READ_ONLY'),
      ).toHaveLength(1);
      if (returning)
        expect(result.definition.recipientId).toBe(original.retained!.ownerId);
    },
  );
  it('is order independent, deterministic and separates all output objects from the inputs', () => {
    const s = recipientProjectionFixture(true);
    const before = clone(s);
    const a = project(s);
    const b = buildArchiveRecipientProjection(
      s.archive,
      [...s.entries].reverse(),
      [...s.files].reverse(),
      [...s.registrations].reverse(),
      projectionUrls,
    );
    expect(a).toEqual(b);
    const { projectionHash, ...definition } = a;
    expect(projectionHash).toBe(archiveHash(definition));
    a.entries.forEach((entry) => {
      entry.payload.nameHistory = [];
      if (entry.retained) entry.retained.ownerId = 'changed';
    });
    a.media[0].revision.etag = 'changed';
    a.definition.recipientId = 'changed';
    expect(s).toEqual(before);
    expect(project(s)).toEqual(b);
  });
  it('handles a no-file dossier without URL rendering', () => {
    const s = metadataRevalidationFixture(0, false);
    const urlForKey = jest.fn(projectionUrls.urlForKey);
    const result = buildArchiveRecipientProjection(
      s.archive,
      s.entries,
      [],
      [],
      { ...projectionUrls, urlForKey },
    );
    expect(result.media).toEqual([]);
    expect(urlForKey).not.toHaveBeenCalled();
    expect(result.entries[0].payload.ownerId).toBe(s.archive.recipientId);
    expect(result.entries[0].payload.nameHistory).toEqual(
      s.entries[0].payload.nameHistory,
    );
  });
  it('ignores only Mongo-owned registry fields and does not leak them to the candidate', () => {
    const s = recipientProjectionFixture();
    const expected = project(s);
    Object.assign(s.registrations[0], { _id: 'mongo', __v: 2 });
    expect(project(s)).toEqual(expected);
  });

  it.each([
    'reservation',
    'consumed',
    'malformed consumption',
    'archive state',
    'plan phase',
    'materialization phase',
    'legacy materialization',
    'entry missing',
    'entry duplicate',
    'extra entry',
    'profile missing',
    'entry scope',
    'payload changed',
    'plan missing',
    'plan changed',
    'unknown binding',
    'duplicate binding',
    'file missing',
    'file duplicate',
    'file orphan',
    'file scope',
    'file definition',
    'file not verified',
    'intent changed',
    'revision changed',
    'lease',
    'registry missing',
    'registry duplicate',
    'registry extra',
    'registry key',
    'registry state',
    'registry digest',
    'registry extra field',
    'cursor',
    'entry count',
    'file count',
  ])(
    'rejects inconsistent %s before rendering recipient URLs, preserving inputs on failure',
    (problem) => {
      const s = recipientProjectionFixture();
      const medical = s.entries.find((e) => e.kind === 'MEDICAL_DOCUMENT')!;
      if (problem === 'reservation') delete s.archive.reservation;
      if (problem === 'consumed' || problem === 'malformed consumption')
        Object.assign(s.archive, {
          evidenceConsumption: problem === 'consumed' ? {} : null,
        });
      if (problem === 'archive state') s.archive.state = 'COPYING';
      if (problem === 'plan phase') s.archive.referencePlan!.phase = 'PLANNING';
      if (problem === 'materialization phase')
        s.archive.materialization!.phase = 'MATERIALIZING';
      if (problem === 'legacy materialization')
        s.archive.materialization!.protocol = 'ARCHIVE_MATERIALIZATION_V1';
      if (problem === 'entry missing') s.entries.pop();
      if (problem === 'entry duplicate') s.entries.push(clone(s.entries[0]));
      if (problem === 'extra entry') {
        const extra = clone(medical);
        extra.id = 'a'.repeat(64);
        s.entries.push(extra);
      }
      if (problem === 'profile missing')
        s.entries = s.entries.filter((e) => e.kind !== 'ANIMAL');
      if (problem === 'entry scope') medical.archiveId = historyUuid(999);
      if (problem === 'payload changed') medical.payload.acceptedAt = 'changed';
      if (problem === 'plan missing') delete medical.referencePlan;
      if (problem === 'plan changed')
        medical.referencePlan!.ownerChange!.to = historyUuid(999);
      if (problem === 'unknown binding') {
        medical.fileBindings[0].path = '/__proto__/polluted';
        rehash(medical);
      }
      if (problem === 'duplicate binding') {
        medical.fileBindings.push(clone(medical.fileBindings[0]));
        rehash(medical);
      }
      if (problem === 'file missing') s.files.pop();
      if (problem === 'file duplicate') s.files.push(clone(s.files[0]));
      if (problem === 'file orphan') {
        const file = clone(s.files[0]);
        file.id = 'a'.repeat(64);
        s.files.push(file);
        s.archive.expectedFileCount!++;
      }
      if (problem === 'file scope') s.files[0].archiveId = historyUuid(999);
      if (problem === 'file definition')
        s.files[0].definitionHash = 'b'.repeat(64);
      if (problem === 'file not verified')
        s.files[0].materialization!.state = 'PENDING';
      if (problem === 'intent changed')
        s.files[0].materialization!.intent.destinationKey += '/other';
      if (problem === 'revision changed')
        s.files[0].materialization!.verified!.etag = 'changed';
      if (problem === 'lease')
        s.files[0].materialization!.leaseToken = historyUuid(999);
      if (problem === 'registry missing') s.registrations.pop();
      if (problem === 'registry duplicate')
        s.registrations.push(clone(s.registrations[0]));
      if (problem === 'registry extra') {
        const r = clone(s.registrations[0]);
        r.fileId = 'a'.repeat(64);
        s.registrations.push(r);
      }
      if (problem === 'registry key') s.registrations[0].key += '/other';
      if (problem === 'registry state')
        Object.assign(s.registrations[0], { state: 'ACTIVE' });
      if (problem === 'registry digest')
        s.registrations[0].sha256 = 'b'.repeat(64);
      if (problem === 'registry extra field')
        Object.assign(s.registrations[0], { canCommit: true });
      if (problem === 'cursor')
        s.archive.referencePlan!.afterId = 'a'.repeat(64);
      if (problem === 'entry count') s.archive.expectedEntryCount!++;
      if (problem === 'file count') s.archive.expectedFileCount!++;
      const before = clone(s);
      const urlForKey = jest.fn(projectionUrls.urlForKey);
      expect(() => project(s, { ...projectionUrls, urlForKey })).toThrow();
      expect(urlForKey).not.toHaveBeenCalled();
      expect(s).toEqual(before);
      expect({}).not.toHaveProperty('polluted');
    },
  );
  it.each([
    'source archive',
    'root identity',
    'source entry',
    'retained entry count',
    'retained file count',
    'history source digest',
    'history self reference',
    'negative history file count',
  ])('rejects retained %s drift', (problem) => {
    const s = recipientProjectionFixture(true);
    const retained = s.entries.find((e) => e.retained)!;
    if (problem === 'source archive')
      retained.retained!.sourceArchiveId = historyUuid(999);
    if (problem === 'root identity')
      retained.retained!.rootEntryId = 'b'.repeat(64);
    if (problem === 'source entry')
      retained.retained!.sourceEntryId = 'invalid';
    if (problem === 'retained entry count')
      s.archive.history!.expectedEntryCount++;
    if (problem === 'retained file count')
      s.archive.history!.expectedFileCount++;
    if (problem === 'history source digest')
      s.archive.history!.sourceDefinitionHash = 'invalid';
    if (problem === 'history self reference')
      s.archive.history!.sourceArchiveId = s.archive.id;
    if (problem === 'negative history file count')
      s.archive.history!.expectedFileCount = -1;
    rehash(retained);
    expect(() => project(s)).toThrow();
  });
  it.each([
    'foreign key',
    'http',
    'query',
    'fragment',
    'credentials',
    'invalid URL',
  ])('rejects bad URL rendering (%s) without changing snapshots', (problem) => {
    const s = recipientProjectionFixture();
    const before = clone(s);
    const urlForKey = (key: string) => {
      if (problem === 'foreign key') return 'https://test/users/other/file';
      if (problem === 'http') return `http://test/${key}`;
      if (problem === 'query') return `https://test/${key}?signature=x`;
      if (problem === 'fragment') return `https://test/${key}#fragment`;
      if (problem === 'credentials') return `https://user:password@test/${key}`;
      return 'invalid';
    };
    expect(() => project(s, { ...projectionUrls, urlForKey })).toThrow();
    expect(s).toEqual(before);
  });
  it('preserves inputs and propagates a rendering failure without returning a partial candidate', () => {
    const s = recipientProjectionFixture();
    const before = clone(s);
    const urlForKey = () => {
      throw new Error('Synthetic codec failure');
    };
    expect(() => project(s, { ...projectionUrls, urlForKey })).toThrow(
      'Synthetic codec failure',
    );
    expect(s).toEqual(before);
  });
});
