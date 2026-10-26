import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  assertSameMediaRegistration,
  buildArchiveMediaRegistration,
} from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { buildArchiveMaterialization } from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { historyClone as clone } from '../fixtures/ownership-archive-history.fixture';
import { registrationFixture } from '../fixtures/ownership-archive-media-registration.fixture';

describe('Transferred media evidence is not publication', () => {
  it.each(['PROFILE', 'DIARY', 'MEDICAL', 'RETAINED'] as const)(
    'registers immutable %s provenance without changing snapshots/active references',
    (kind) => {
      const s = registrationFixture(kind);
      const before = clone([s.archive, s.file, s.entry]);
      const result = buildArchiveMediaRegistration(
        s.archive,
        s.file,
        s.entry.referencePlan!,
      );
      expect(result).toEqual(s.registration);
      expect([s.archive, s.file, s.entry]).toEqual(before);
      expect(result.key).toBe(s.intent.destinationKey);
      expect(result.key).not.toBe(s.file.recipientFinalKey);
      expect(result.state).toBe('PREPARED');
      expect(result.fromOwnerId).toBe(s.archive.ownerId);
      expect(result.recipientId).toBe(s.archive.recipientId);
      expect(result.sourcePeriodId).toBe(s.archive.periodId);
      expect(result.sourceOwnershipVersion).toBe(s.archive.ownershipVersion);
      expect(result.intentDefinitionHash).toBe(s.intent.definitionHash);
      expect(result.mode).toBe(
        kind === 'RETAINED' ? 'RETAINED_READ_ONLY' : 'LIVE_RESOURCE',
      );
      expect(result.retained).toEqual(s.file.retained);
      for (const field of [
        'payload',
        'url',
        'uploadUrl',
        'ownerId',
        'sealed',
        'pinned',
        'publishedAt',
        'acceptedAt',
      ])
        expect(result).not.toHaveProperty(field);
      result.revision.etag = 'changed';
      expect(s.file.materialization!.verified!.etag).toBe('final');
      if (result.retained) {
        result.retained.rootFileId = 'changed';
        expect(s.file.retained!.rootFileId).not.toBe('changed');
      }
    },
  );
  it('keeps unversioned results explicit, never invents a VersionId', () => {
    const s = registrationFixture('MEDICAL', false);
    expect(s.registration.revision).not.toHaveProperty('versionId');
  });
  it('does not copy extra mixed verification metadata into the registry', () => {
    const s = registrationFixture();
    Object.assign(s.file.materialization!.verified!, {
      payload: { secret: 'not evidence' },
      signedUrl: 'https://private/',
    });
    const result = buildArchiveMediaRegistration(
      s.archive,
      s.file,
      s.entry.referencePlan!,
    );
    expect(result).toEqual(s.registration);
    expect(result.revision).not.toHaveProperty('payload');
    expect(result.revision).not.toHaveProperty('signedUrl');
  });
  it.each(['', 123])(
    'rejects malformed final VersionId %s rather than normalizing evidence',
    (versionId) => {
      const s = registrationFixture();
      Object.assign(s.file.materialization!.verified!, { versionId });
      expect(() =>
        buildArchiveMediaRegistration(
          s.archive,
          s.file,
          s.entry.referencePlan!,
        ),
      ).toThrow();
    },
  );
  it.each([
    'V1',
    'materializing',
    'unverified',
    'pending copy',
    'lease',
    'wrong plan',
    'wrong intent',
    'wrong revision',
    'wrong mode',
  ])('rejects registration with %s', (problem) => {
    const s = registrationFixture();
    if (problem === 'V1')
      s.archive.materialization = {
        ...buildArchiveMaterialization(s.archive),
        phase: 'MATERIALIZED',
      };
    if (problem === 'materializing')
      s.archive.materialization!.phase = 'MATERIALIZING';
    if (problem === 'unverified') s.file.state = 'PENDING';
    if (problem === 'pending copy') s.file.materialization!.state = 'PENDING';
    if (problem === 'lease') s.file.materialization!.leaseToken = 'stale';
    if (problem === 'wrong plan') s.entry.referencePlan!.planHash = 'changed';
    if (problem === 'wrong intent')
      s.file.materialization!.intent = {
        ...s.intent,
        destinationKey: s.file.recipientFinalKey,
      };
    if (problem === 'wrong revision') s.file.materialization!.verified!.size++;
    if (problem === 'wrong mode') {
      const { planHash: _hash, ...plan } = s.entry.referencePlan!;
      expect(_hash).toHaveLength(64);
      plan.mode = 'RETAINED_READ_ONLY';
      s.entry.referencePlan = { ...plan, planHash: archiveHash(plan) };
    }
    expect(() =>
      buildArchiveMediaRegistration(s.archive, s.file, s.entry.referencePlan!),
    ).toThrow();
  });
  it('preserves root and immediate retained provenance without treating the sender as original author', () => {
    const s = registrationFixture('RETAINED');
    expect(s.registration.retained!.sourceArchiveId).toBe(
      s.archive.history!.sourceArchiveId,
    );
    expect(s.registration.retained!.rootArchiveId).not.toBe(s.archive.id);
    expect(s.registration.retained!.sha256).toBe(s.registration.sha256);
  });
  it.each([
    'key',
    'revision',
    'sha256',
    'recipientId',
    'state',
    'extra',
    'definitionHash',
  ])(
    'never adopts different persisted %s even if its stored hash is reused',
    (problem) => {
      const s = registrationFixture();
      const stored = clone(s.registration);
      if (problem === 'key') stored.key = s.file.recipientFinalKey;
      if (problem === 'revision') stored.revision.etag = 'other';
      if (problem === 'sha256') stored.sha256 = 'b'.repeat(64);
      if (problem === 'recipientId') stored.recipientId = s.archive.ownerId;
      if (problem === 'state') Object.assign(stored, { state: 'PUBLISHED' });
      if (problem === 'extra')
        Object.assign(stored, { payload: { medical: 'must not persist' } });
      if (problem === 'definitionHash') stored.definitionHash = 'changed';
      expect(() =>
        assertSameMediaRegistration(stored, s.registration),
      ).toThrow();
    },
  );
  it('ignores only Mongo-owned fields, not technical evidence', () => {
    const s = registrationFixture();
    expect(() =>
      assertSameMediaRegistration(
        { ...s.registration, _id: 'mongo', __v: 0 } as typeof s.registration,
        s.registration,
      ),
    ).not.toThrow();
  });
});
