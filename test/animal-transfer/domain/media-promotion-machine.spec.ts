import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';
import { AnimalMediaUpload } from '../../../src/context/animal-media/domain/animal-media-upload';
import { promotionDefinitionHash } from '../../../src/context/animal-media/domain/media-promotion-effect';
import {
  MediaPromotionCommand,
  advanceMediaPromotion,
  createMediaPromotionModel,
  summarizeMediaPromotion,
} from '../../../src/context/animal-media/domain/media-promotion-machine';
import { promotionFixture } from '../fixtures/media-promotion.fixture';

describe('Pure ordinary media promotion protocol', () => {
  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'binds %s identity and exact conditional copy without changing inputs',
    (kind) => {
      const s = promotionFixture(kind);
      const before = structuredClone([s.journal, s.upload, s.initial]);
      const effect = s.declared.effects[0];
      expect(s.declared.scope).toEqual({
        operationId: s.journal.id,
        instanceId: s.journal.instanceId,
        animalId: s.animalId,
        ownerId: s.journal.actorId,
        ownershipVersion: 2,
        kind,
      });
      expect(effect.definition).toEqual({
        bucket: 'animalrecord-test-media',
        uploadId: s.upload.id,
        source: { key: s.upload.stagingKey, ...s.upload.pinned },
        destinationKey: s.upload.finalKey,
        mimeType: s.upload.mimeType,
        destinationIfNoneMatch: '*',
      });
      expect(effect.definition.source).not.toHaveProperty('versionId');
      expect(effect.definitionHash).toHaveLength(64);
      expect([s.journal, s.upload, s.initial]).toEqual(before);
      effect.definition.source.etag = 'changed';
      expect(s.upload.pinned!.etag).toBe('"source"');
    },
  );

  it('pins optional VersionId and hashes canonically without copying secret mixed fields', () => {
    const s = promotionFixture();
    s.upload.pinned!.versionId = 'version-1';
    Object.assign(s.upload, {
      payload: 'private',
      uploadUrl: 'https://signed',
    });
    Object.assign(s.upload.pinned!, { secret: 'ignored' });
    const effect = advanceMediaPromotion(s.initial, 0, s.declaration)
      .effects[0];
    expect(effect.definition.source.versionId).toBe('version-1');
    expect(JSON.stringify(effect)).not.toMatch(/private|signed|ignored/);
    const reordered = {
      ...effect.definition,
      source: {
        ...effect.definition.source,
        key: effect.definition.source.key,
      },
    };
    expect(promotionDefinitionHash(s.initial.scope, effect.id, reordered)).toBe(
      effect.definitionHash,
    );
    const changed = structuredClone(effect.definition);
    delete changed.source.versionId;
    expect(
      promotionDefinitionHash(s.initial.scope, effect.id, changed),
    ).not.toBe(effect.definitionHash);
    expect(
      promotionDefinitionHash(s.initial.scope, effect.id, {
        ...effect.definition,
        bucket: 'another-bucket',
      }),
    ).not.toBe(effect.definitionHash);
  });

  it.each(['', 'https://signed?key=value', 'bucket\n'])(
    'rejects invalid storage target %j',
    (bucket) => {
      const s = promotionFixture();
      expect(() =>
        advanceMediaPromotion(s.initial, 0, { ...s.declaration, bucket }),
      ).toThrow();
    },
  );

  const invalidJournals: Array<[string, (j: AnimalWriteJournal) => void]> = [
    [
      'legacy protocol',
      (j) => {
        delete j.protocol;
      },
    ],
    [
      'terminal',
      (j) => {
        j.lifecycle = 'LOCALLY_FINISHED';
      },
    ],
    [
      'not started',
      (j) => {
        j.callback = 'NOT_STARTED';
      },
    ],
    [
      'not invoked after permission',
      (j) => {
        j.callback = 'NOT_INVOKED';
      },
    ],
    [
      'returned',
      (j) => {
        j.callback = 'RETURNED';
      },
    ],
    [
      'threw',
      (j) => {
        j.callback = 'THREW';
      },
    ],
    [
      'no permission',
      (j) => {
        delete j.callbackPermittedAt;
      },
    ],
    [
      'invalid permission time',
      (j) => {
        j.callbackPermittedAt = 'bad';
      },
    ],
    [
      'wrong kind',
      (j) => {
        j.kind = 'DIARY_CREATE';
      },
    ],
    [
      'URL issuer',
      (j) => {
        j.issuesUploadUrl = true;
      },
    ],
    [
      'wrong animal',
      (j) => {
        j.claims[0].animalId = j.id;
      },
    ],
    [
      'no claims',
      (j) => {
        j.claims = [];
      },
    ],
    [
      'duplicate claim',
      (j) => {
        j.claims.push({ ...j.claims[0] });
      },
    ],
    [
      'released',
      (j) => {
        j.claims[0].state = 'RELEASED';
      },
    ],
    [
      'no version',
      (j) => {
        delete j.claims[0].ownershipVersion;
      },
    ],
    [
      'zero version',
      (j) => {
        j.claims[0].ownershipVersion = 0;
      },
    ],
    [
      'fractional version',
      (j) => {
        j.claims[0].ownershipVersion = 1.5;
      },
    ],
    [
      'bad operation UUID',
      (j) => {
        j.id = 'bad';
      },
    ],
  ];
  it.each(invalidJournals)(
    'rejects %s without inventing a journal binding',
    (_name, mutate) => {
      const s = promotionFixture();
      mutate(s.journal);
      expect(() => createMediaPromotionModel(s.journal, s.animalId)).toThrow();
    },
  );

  const invalidUploads: Array<[string, (u: AnimalMediaUpload) => void]> = [
    [
      'legacy',
      (u) => {
        u.legacy = { migrationId: u.id, sourceUrl: 'source', kind: 'PROFILE' };
      },
    ],
    [
      'sealed',
      (u) => {
        u.sealed = { etag: 'final', size: 32 };
      },
    ],
    [
      'unpinned',
      (u) => {
        delete u.pinned;
      },
    ],
    [
      'other owner',
      (u) => {
        u.ownerId = u.id;
      },
    ],
    [
      'other animal',
      (u) => {
        u.animalId = u.id;
      },
    ],
    [
      'retarget',
      (u) => {
        u.finalKey = 'another/key';
      },
    ],
    [
      'source outside intake',
      (u) => {
        u.stagingKey = u.finalKey;
      },
    ],
    [
      'wrong ticket source',
      (u) => {
        u.stagingKey = u.stagingKey.replace(u.id, u.ownerId);
      },
    ],
    [
      'no digest',
      (u) => {
        u.pinned!.sha256 = '';
      },
    ],
    [
      'digest newline',
      (u) => {
        u.pinned!.sha256 += '\n';
      },
    ],
    [
      'empty version',
      (u) => {
        u.pinned!.versionId = '';
      },
    ],
    [
      'empty etag',
      (u) => {
        u.pinned!.etag = '';
      },
    ],
    [
      'invalid MIME',
      (u) => {
        u.mimeType = 'image/jpeg\n';
      },
    ],
    [
      'wrong profile MIME',
      (u) => {
        u.mimeType = 'image/png';
      },
    ],
    [
      'wrong size',
      (u) => {
        u.size++;
      },
    ],
    [
      'multipart required',
      (u) => {
        u.size = 5 * 1024 ** 3 + 1;
        u.pinned!.size = u.size;
      },
    ],
    [
      'generation',
      (u) => {
        u.finalKey = u.finalKey.replace('123', `000${'1'.repeat(78)}`);
      },
    ],
    [
      'newline key',
      (u) => {
        u.finalKey += '\n';
      },
    ],
  ];
  it.each(invalidUploads)(
    'rejects %s without declaring a remote effect',
    (_name, mutate) => {
      const s = promotionFixture();
      mutate(s.upload);
      expect(() =>
        advanceMediaPromotion(s.initial, 0, s.declaration),
      ).toThrow();
      expect(s.initial.effects).toEqual([]);
    },
  );

  it('does not accept profile as diary, diary as profile, or arbitrary diary IDs', () => {
    const profile = promotionFixture(),
      diary = promotionFixture('ATTACHMENT_CONFIRM');
    expect(() =>
      advanceMediaPromotion(diary.initial, 0, profile.declaration),
    ).toThrow();
    expect(() =>
      advanceMediaPromotion(profile.initial, 0, diary.declaration),
    ).toThrow();
    diary.upload.finalKey = diary.upload.finalKey.replace(
      diary.id(8),
      'not-a-uuid',
    );
    expect(() =>
      advanceMediaPromotion(diary.initial, 0, diary.declaration),
    ).toThrow();
  });

  it('prevents identity/resource reuse, retargeting and unauthorized responses', () => {
    const s = promotionFixture();
    const commands: MediaPromotionCommand[] = [
      s.declaration,
      s.intention,
      { ...s.declaration, effectId: s.id(20) },
      { ...s.authorize, effectId: s.id(20) },
      { ...s.authorize, attemptId: s.id(20) },
      { ...s.authorize, authorizationId: s.effectId },
      {
        type: 'RECORD_RESPONSE',
        effectId: s.effectId,
        attemptId: s.attemptId,
        responseId: s.id(20),
        outcome: 'UNKNOWN',
        evidenceRef: 'error:1',
      },
    ];
    for (const command of commands)
      expect(() => advanceMediaPromotion(s.intended, 2, command)).toThrow();
    const changed = structuredClone(s.intended);
    changed.effects[0].definition.destinationKey += 'changed';
    expect(() => advanceMediaPromotion(changed, 2, s.authorize)).toThrow();
    expect(() => advanceMediaPromotion(s.intended, 1, s.authorize)).toThrow();
    expect(() =>
      advanceMediaPromotion(
        { ...s.intended, revision: Number.MAX_SAFE_INTEGER },
        Number.MAX_SAFE_INTEGER,
        s.authorize,
      ),
    ).toThrow();
  });

  it.each([
    '',
    ':bad',
    'https://signed?key=value',
    'clinical data',
    'ref\n',
    'a'.repeat(201),
  ])('rejects unsafe evidence %j atomically', (evidenceRef) => {
    const s = promotionFixture();
    expect(() =>
      advanceMediaPromotion(s.intended, 2, { ...s.revoke, evidenceRef }),
    ).toThrow();
    expect(s.intended.gate.state).toBe('OPEN');
  });

  it('cannot reuse a granted authorization or retry without its own intent/grant', () => {
    const s = promotionFixture();
    const authorized = advanceMediaPromotion(s.intended, 2, s.authorize);
    expect(() => advanceMediaPromotion(authorized, 3, s.authorize)).toThrow();
    for (const origin of ['APPLICATION_RETRY', 'SDK_RETRY'] as const) {
      const retry: MediaPromotionCommand = {
        ...s.intention,
        attemptId: s.id(20),
        origin,
        previousAttemptId: s.attemptId,
      };
      const next = advanceMediaPromotion(authorized, 3, retry);
      expect(next.effects[0].attempts[1]).toMatchObject({
        ordinal: 2,
        previousAttemptId: s.attemptId,
        origin,
      });
      expect(summarizeMediaPromotion(next).authorizedAttemptIds).toEqual([
        s.attemptId,
      ]);
      expect(() =>
        advanceMediaPromotion(next, 4, { ...s.authorize, attemptId: s.id(20) }),
      ).toThrow();
      const granted = advanceMediaPromotion(next, 4, {
        ...s.authorize,
        attemptId: s.id(20),
        authorizationId: s.id(21),
      });
      expect(summarizeMediaPromotion(granted).authorizedAttemptIds).toEqual([
        s.attemptId,
        s.id(20),
      ]);
    }
    expect(() =>
      advanceMediaPromotion(authorized, 3, {
        ...s.intention,
        attemptId: s.id(20),
      }),
    ).toThrow();
    expect(() =>
      advanceMediaPromotion(authorized, 3, {
        ...s.intention,
        attemptId: s.id(20),
        origin: 'SDK_RETRY',
        previousAttemptId: s.id(21),
      }),
    ).toThrow();
    expect(() =>
      advanceMediaPromotion(s.intended, 2, {
        ...s.intention,
        attemptId: s.id(20),
        origin: 'SDK_RETRY',
        previousAttemptId: s.attemptId,
      }),
    ).toThrow();
  });

  it('keeps unknown, late ACK, MATCH, ABSENT and CONFLICT evidence without discharging authorized attempts', () => {
    const s = promotionFixture();
    let model = advanceMediaPromotion(s.intended, 2, s.authorize);
    model = advanceMediaPromotion(model, model.revision, s.revoke);
    for (const [index, outcome] of (
      ['UNKNOWN', 'ACKNOWLEDGED'] as const
    ).entries())
      model = advanceMediaPromotion(model, model.revision, {
        type: 'RECORD_RESPONSE',
        effectId: s.effectId,
        attemptId: s.attemptId,
        responseId: s.id(20 + index),
        outcome,
        evidenceRef: `receipt:${index}`,
      });
    for (const [index, finding] of (
      ['ABSENT', 'MATCH', 'CONFLICT'] as const
    ).entries()) {
      const observation =
        finding === 'MATCH'
          ? {
              id: s.id(30 + index),
              finding,
              evidenceRef: 'read:match',
              uploadId: s.upload.id,
              sha256: s.upload.pinned!.sha256,
              revision: { etag: 'final', size: s.upload.size },
            }
          : { id: s.id(30 + index), finding, evidenceRef: 'read:other' };
      model = advanceMediaPromotion(model, model.revision, {
        type: 'OBSERVE_DESTINATION',
        effectId: s.effectId,
        observation,
      });
    }
    const summary = summarizeMediaPromotion(model);
    expect(summary).toMatchObject({
      coverage: 'INCOMPLETE',
      remoteEffects: 'NOT_ASSESSED',
      authorizedAttemptIds: [s.attemptId],
      dispatchPrecludedAttemptIds: [],
    });
    expect(summary.responses.map((r) => r.outcome)).toEqual([
      'UNKNOWN',
      'ACKNOWLEDGED',
    ]);
    expect(summary.observations.map((o) => o.finding)).toEqual([
      'ABSENT',
      'MATCH',
      'CONFLICT',
    ]);
    expect(summary).not.toHaveProperty('canCommit');
    expect(summary).not.toHaveProperty('remoteClosed');
    summary.observations[0].evidenceRef = 'changed';
    expect(model.effects[0].observations[0].evidenceRef).toBe('read:other');
  });

  it.each(['upload', 'digest', 'size', 'etag', 'version'] as const)(
    'rejects a MATCH with wrong %s',
    (field) => {
      const s = promotionFixture();
      const observation = {
        id: s.id(20),
        finding: 'MATCH' as const,
        evidenceRef: 'read:1',
        uploadId: s.upload.id,
        sha256: s.upload.pinned!.sha256,
        revision: { etag: 'final', size: 32, versionId: 'v1' },
      };
      if (field === 'upload') observation.uploadId = s.id(21);
      if (field === 'digest') observation.sha256 = 'b'.repeat(64);
      if (field === 'size') observation.revision.size++;
      if (field === 'etag') observation.revision.etag = '';
      if (field === 'version') observation.revision.versionId = '';
      expect(() =>
        advanceMediaPromotion(s.intended, 2, {
          type: 'OBSERVE_DESTINATION',
          effectId: s.effectId,
          observation,
        }),
      ).toThrow();
    },
  );
});
