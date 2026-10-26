import { archiveGenerationKey } from '../../../src/context/animal-transfer/domain/ownership-archive-generation';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL as GENERATIONAL,
  assertArchiveMaterialization,
  assertMaterializationIntent,
  buildArchiveMaterializationIntent,
  verifiedArchiveMaterializationDestination,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  isDirectAnimalMediaKey,
  isReservedArchiveGenerationKey,
} from '../../../src/context/animal-media/domain/animal-media-upload';
import { materializationFixture } from '../fixtures/ownership-archive-materialization.fixture';
import { historyUuid } from '../fixtures/ownership-archive-history.fixture';

describe('Explicit immutable archive generations', () => {
  const fixture = () => materializationFixture(undefined, true, GENERATIONAL);
  it('pins an effective destination without modifying the manifest or reference plan', () => {
    const s = fixture();
    const before = archiveHash([s.file, s.entry, s.archive.referencePlan]);
    const intent = buildArchiveMaterializationIntent(
      s.archive,
      s.file,
      s.entry.referencePlan!,
    );
    expect(intent.protocol).toBe(GENERATIONAL);
    expect(intent.destinationKey).not.toBe(s.file.recipientFinalKey);
    expect(intent.destinationKey).toContain(
      `/transfer-generations/${s.archive.id}/${s.file.id}/`,
    );
    expect(intent.destinationKey.split('/').pop()).toBe(
      s.file.recipientFinalKey.split('/').pop(),
    );
    expect(intent.source).toEqual(s.intent.source);
    expect(archiveHash([s.file, s.entry, s.archive.referencePlan])).toBe(
      before,
    );
    expect(() => assertMaterializationIntent(intent)).not.toThrow();
  });
  it.each([
    'diary/entry/attachment.pdf',
    'medical-documents/referrals/doc/revisions/revision/source.pdf',
    'retained-history/root/file/medical-documents/referrals/doc/source.pdf',
  ])('keeps hierarchy and file name for %s', (relative) => {
    const s = fixture();
    const prefix = `users/${s.archive.recipientId}/animals/${s.archive.animalId}/`;
    const key = archiveGenerationKey(
      s.archive.id,
      s.file.id,
      prefix + relative,
    );
    const parent = relative.slice(0, relative.lastIndexOf('/'));
    expect(key).toBe(
      `${prefix}${parent}/transfer-generations/${s.archive.id}/${s.file.id}/${relative.split('/').pop()}`,
    );
    if (relative.startsWith('diary/'))
      expect(isDirectAnimalMediaKey(key)).toBe(true);
    expect(isReservedArchiveGenerationKey(key)).toBe(true);
  });
  it.each(['jpeg', 'png', 'webp'])(
    'preserves numeric profile syntax and guard for %s',
    (ext) => {
      const s = fixture();
      const prefix = `users/${s.archive.recipientId}/animals/${s.archive.animalId}/`;
      const first = archiveGenerationKey(
        s.archive.id,
        s.file.id,
        `${prefix}profile_123.${ext}`,
      );
      expect(first.slice(prefix.length)).toMatch(
        /^profile_\d+\.(jpeg|png|webp)$/,
      );
      expect(isDirectAnimalMediaKey(first)).toBe(true);
      expect(isReservedArchiveGenerationKey(first)).toBe(true);
      expect(first).not.toBe(`${prefix}profile_123.${ext}`);
      expect(archiveGenerationKey(historyUuid(999), s.file.id, first)).not.toBe(
        first,
      );
    },
  );
  it.each([
    'ownership-archives/old/a.pdf',
    'transfer-preparations/id/a.pdf',
    'upload-intake/id/a.pdf',
    'other/a.pdf',
    'profile_abc.png',
    'diary/../a.pdf',
    'diary//a.pdf',
    'diary/a\\b.pdf',
    'medical-documents/' + 'á'.repeat(600),
  ])('fails closed for unsupported/unsafe destination %s', (relative) => {
    const s = fixture();
    expect(() =>
      archiveGenerationKey(
        s.archive.id,
        s.file.id,
        `users/${s.archive.recipientId}/animals/${s.archive.animalId}/${relative}`,
      ),
    ).toThrow();
  });
  it.each([
    'legacy target',
    'other generation',
    'other owner',
    'changed protocol',
  ])('rejects %s even with a recalculated intent hash', (problem) => {
    const s = fixture();
    const { definitionHash: _hash, ...definition } = s.intent;
    expect(_hash).toHaveLength(64);
    if (problem === 'legacy target')
      definition.destinationKey = s.file.recipientFinalKey;
    if (problem === 'other generation')
      definition.destinationKey = definition.destinationKey.replace(
        s.archive.id,
        historyUuid(999),
      );
    if (problem === 'other owner')
      definition.destinationKey = definition.destinationKey.replace(
        s.archive.recipientId,
        s.archive.ownerId,
      );
    if (problem === 'changed protocol')
      definition.protocol = 'ARCHIVE_MATERIALIZATION_V1';
    expect(() =>
      assertMaterializationIntent({
        ...definition,
        definitionHash: archiveHash(definition),
      }),
    ).toThrow();
  });
  it('refuses switching only the header protocol or resolving unverified destinations', () => {
    const s = fixture();
    expect(() =>
      verifiedArchiveMaterializationDestination(
        s.archive,
        s.file,
        s.entry.referencePlan!,
      ),
    ).toThrow();
    s.archive.materialization!.protocol = 'ARCHIVE_MATERIALIZATION_V1';
    expect(() => assertArchiveMaterialization(s.archive)).toThrow();
  });
  it('keeps repeated return generations distinct without flattening inherited hierarchy', () => {
    const s = fixture();
    const first = archiveGenerationKey(
      s.archive.id,
      s.file.id,
      s.file.recipientFinalKey,
    );
    const second = archiveGenerationKey(
      historyUuid(999),
      'b'.repeat(64),
      first,
    );
    expect(second).not.toBe(first);
    expect(second).toContain(
      `/transfer-generations/${s.archive.id}/${s.file.id}/`,
    );
    expect(second).toContain(
      `/transfer-generations/${historyUuid(999)}/${'b'.repeat(64)}/`,
    );
    expect(
      archiveGenerationKey(s.archive.id, s.file.id, s.file.recipientFinalKey),
    ).toBe(first);
    expect(
      archiveGenerationKey(
        s.archive.id,
        'b'.repeat(64),
        s.file.recipientFinalKey,
      ),
    ).not.toBe(first);
  });
  it.each(['pending', 'wrong size', 'no etag', 'wrong identity'])(
    'does not resolve incomplete or inconsistent evidence (%s)',
    (problem) => {
      const s = fixture();
      s.archive.materialization!.phase = 'MATERIALIZED';
      s.file.materialization = {
        intent: s.intent,
        state: 'VERIFIED',
        verified: { etag: 'final', size: s.intent.source.size },
      };
      if (problem === 'pending') s.file.materialization.state = 'PENDING';
      if (problem === 'wrong size') s.file.materialization.verified!.size++;
      if (problem === 'no etag') s.file.materialization.verified!.etag = '';
      if (problem === 'wrong identity')
        s.file.materialization.intent = { ...s.intent, definitionHash: 'bad' };
      expect(() =>
        verifiedArchiveMaterializationDestination(
          s.archive,
          s.file,
          s.entry.referencePlan!,
        ),
      ).toThrow();
    },
  );
  it('resolves verified effective references, not the old planned destination', () => {
    const s = fixture();
    s.archive.materialization!.phase = 'MATERIALIZED';
    s.file.materialization = {
      intent: s.intent,
      state: 'VERIFIED',
      verified: { etag: 'final', size: s.intent.source.size },
    };
    const result = verifiedArchiveMaterializationDestination(
      s.archive,
      s.file,
      s.entry.referencePlan!,
    );
    expect(result.key).toBe(s.intent.destinationKey);
    expect(result.key).not.toBe(
      s.entry.referencePlan!.bindings[0].recipient.plannedFinalKey,
    );
    result.revision.etag = 'mutated';
    expect(s.file.materialization.verified!.etag).toBe('final');
    s.file.materialization.intent = {
      ...s.intent,
      destinationKey: s.file.recipientFinalKey,
    };
    expect(() =>
      verifiedArchiveMaterializationDestination(
        s.archive,
        s.file,
        s.entry.referencePlan!,
      ),
    ).toThrow();
  });
});
