import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { MediaPromotionVerifier } from '../../../src/context/animal-media/application/media-promotion-verifier';
import {
  MediaPromotionDestinationReader,
  PromotionDestinationHead,
  PromotionMatch,
} from '../../../src/context/animal-media/domain/media-promotion-sealing';
import { MongoAnimalMediaUploadRepository } from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  promotionStoreFixture,
  PromotionTestRow,
} from '../fixtures/media-promotion-store.fixture';
import { bounded, deferred } from '../integration/support/write-race-gate';

const bytes = Buffer.alloc(32, 'a'),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const final = { etag: '"final"', size: 32, versionId: 'final/version 1' };
async function setup(
  kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
) {
  const f = promotionStoreFixture(kind);
  f.change('uploads', (rows) => {
    (rows[0].pinned as PromotionTestRow).sha256 = sha256;
  });
  await f.prepare();
  await f.repository.apply(f.selection, 2, f.authorize);
  const subject = await f.repository.readForSeal(f.selection, f.effectId);
  const head: PromotionDestinationHead = {
    ...final,
    bucket: subject.effect.bucket,
    key: subject.effect.destinationKey,
    mimeType: subject.effect.data.definition.mimeType,
    uploadId: f.upload.id,
    sha256,
  };
  const close = jest.fn();
  const reader = {
    head: jest
      .fn<
        ReturnType<MediaPromotionDestinationReader['head']>,
        Parameters<MediaPromotionDestinationReader['head']>
      >()
      .mockImplementation(() => Promise.resolve(structuredClone(head))),
    read: jest
      .fn<
        ReturnType<MediaPromotionDestinationReader['read']>,
        Parameters<MediaPromotionDestinationReader['read']>
      >()
      .mockImplementation(() =>
        Promise.resolve({
          revision: { ...final },
          body: Readable.from([bytes]),
          close,
        }),
      ),
  } satisfies MediaPromotionDestinationReader;
  const input = {
    selection: { ...f.selection },
    effectId: f.effectId,
    scope: { ...f.initial.scope },
    observationId: f.id(40),
  };
  const observation: PromotionMatch = {
    id: input.observationId,
    finding: 'MATCH',
    uploadId: f.upload.id,
    sha256,
    revision: { ...final },
    evidenceRef: 'test:verified-final',
  };
  return {
    ...f,
    subject,
    head,
    reader,
    close,
    input,
    observation,
    verifier: new MediaPromotionVerifier(f.repository, reader),
    seal: () => f.repository.sealVerified(f.selection, subject, observation),
    observationRows: () =>
      f.state().records.filter((r) => r.kind === 'OBSERVATION'),
  };
}

describe('Isolated promotion verification and transactional seal, simulated Mongo/S3', () => {
  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'verifies %s bytes and atomically persists MATCH/seal without closing prior grants',
    async (kind) => {
      const f = await setup(kind),
        before = f.state(),
        start = f.log.length;
      await f.verifier.verifyAndSeal(f.input);
      const after = f.state();
      expect(f.reader.head).toHaveBeenCalledTimes(2);
      expect(f.reader.read).toHaveBeenCalledTimes(1);
      expect(f.reader.read.mock.calls[0][0]).toEqual(
        f.subject.effect.data.definition,
      );
      expect(f.reader.read.mock.calls[0][1]).toEqual(final);
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(after.uploads[0].sealed).toEqual(final);
      expect(after.uploads[0].mediaPromotionRevision).toBe(4);
      expect(f.observationRows()).toHaveLength(1);
      expect(f.observationRows()[0]).toMatchObject({
        id: f.input.observationId,
        data: { finding: 'MATCH', sha256, revision: final },
      });
      expect(after.records.find((r) => r.id === f.attemptId)).toEqual(
        before.records.find((r) => r.id === f.attemptId),
      );
      const writes = f.log.slice(start).filter((r) => r.method !== 'findOne');
      expect(writes.map((w) => w.kind)).toEqual([
        'journals',
        'controls',
        'uploads',
        'records',
        'records',
      ]);
      expect(writes.every((r) => r.session)).toBe(true);
      expect(after.controls[0].activeWrites).toEqual(
        before.controls[0].activeWrites,
      );
    },
  );

  const mutations: Array<[string, (h: PromotionDestinationHead) => void]> = [
    [
      'bucket',
      (h) => {
        h.bucket = 'other';
      },
    ],
    [
      'key',
      (h) => {
        h.key = 'other';
      },
    ],
    [
      'mime',
      (h) => {
        h.mimeType = 'text/plain';
      },
    ],
    [
      'upload',
      (h) => {
        h.uploadId = 'other';
      },
    ],
    [
      'digest',
      (h) => {
        h.sha256 = 'a'.repeat(64);
      },
    ],
    [
      'size',
      (h) => {
        h.size = 33;
      },
    ],
    [
      'etag',
      (h) => {
        h.etag = '';
      },
    ],
    [
      'version',
      (h) => {
        h.versionId = '\n';
      },
    ],
  ];
  describe.each(['first', 'second'] as const)('%s HEAD mismatch', (when) => {
    it.each(mutations)(
      'rejects %s without MATCH/seal',
      async (_field, change) => {
        const f = await setup(),
          before = f.state();
        const bad = { ...f.head };
        change(bad);
        f.reader.head
          .mockResolvedValueOnce(when === 'first' ? bad : f.head)
          .mockResolvedValueOnce(bad);
        await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
          stage: 'VERIFY',
          reason: 'CONFLICT',
        });
        expect(f.state()).toEqual(before);
        expect(f.reader.read).toHaveBeenCalledTimes(when === 'first' ? 0 : 1);
        expect(f.close).toHaveBeenCalledTimes(when === 'first' ? 0 : 1);
      },
    );
  });

  it.each(['first', 'second'] as const)(
    'rejects absent %s HEAD without treating it as permission or rollback',
    async (when) => {
      const f = await setup(),
        before = f.state();
      f.reader.head
        .mockResolvedValueOnce(when === 'first' ? null : f.head)
        .mockResolvedValueOnce(null);
      await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
        stage: 'VERIFY',
        reason: 'CONFLICT',
      });
      expect(f.state()).toEqual(before);
    },
  );

  it.each(['etag', 'versionId', 'size'] as const)(
    'rejects changed GET %s and always closes its body',
    async (field) => {
      const f = await setup(),
        revision = { ...final, [field]: field === 'size' ? 33 : 'different' };
      f.reader.read.mockResolvedValue({
        revision,
        body: Readable.from([bytes]),
        close: f.close,
      });
      await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
        stage: 'VERIFY',
        reason: 'CONFLICT',
      });
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.observationRows()).toHaveLength(0);
    },
  );

  it.each([
    'truncated',
    'oversized',
    'different',
    'invalid-chunk',
    'stream-error',
  ] as const)('rejects %s stream and never seals', async (mode) => {
    const f = await setup(),
      before = f.state();
    async function* body() {
      await Promise.resolve();
      if (mode === 'stream-error')
        throw new Error('secret remote transport error');
      yield mode === 'truncated'
        ? bytes.subarray(0, 31)
        : mode === 'oversized'
          ? Buffer.alloc(33)
          : mode === 'different'
            ? Buffer.alloc(32, 'b')
            : mode === 'invalid-chunk'
              ? ('text' as unknown as Uint8Array)
              : bytes;
    }
    f.reader.read.mockResolvedValue({
      revision: final,
      body: body(),
      close: f.close,
    });
    await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: mode === 'stream-error' ? 'UNAVAILABLE' : 'CONFLICT',
    });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.state()).toEqual(before);
  });

  it('rejects a current final that changes after GET despite valid bytes from its earlier version', async () => {
    const f = await setup();
    f.reader.head.mockResolvedValueOnce(f.head).mockResolvedValueOnce({
      ...f.head,
      etag: '"changed"',
      versionId: 'later',
    });
    await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: 'CONFLICT',
    });
    expect(f.observationRows()).toHaveLength(0);
  });

  it('captures input identity before read and prevents reader mutation of definition/revision', async () => {
    const f = await setup();
    f.reader.read.mockImplementation((definition, revision) => {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.source)).toBe(true);
      expect(Object.isFrozen(revision)).toBe(true);
      return Promise.resolve({
        revision: final,
        body: Readable.from([bytes]),
        close: f.close,
      });
    });
    const pending = f.verifier.verifyAndSeal(f.input);
    f.input.observationId = f.id(41);
    f.input.scope.ownerId = f.id(42);
    f.input.selection.operationId = f.id(43);
    await pending;
    expect(f.observationRows()[0].id).toBe(f.id(40));
  });

  it.each(['scope', 'effect', 'observation-id'] as const)(
    'denies mismatching %s before remote reads',
    async (field) => {
      const f = await setup();
      if (field === 'scope') f.input.scope.ownerId = f.id(99);
      if (field === 'effect') f.input.effectId = f.id(99);
      if (field === 'observation-id') f.input.observationId = 'invalid';
      await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
        stage: 'READ',
        reason: 'CONFLICT',
      });
      expect(f.reader.head).not.toHaveBeenCalled();
    },
  );

  it.each(['read', 'head', 'stream', 'seal'] as const)(
    'sanitizes %s errors without raw cause, payload or retry metadata',
    async (stage) => {
      const f = await setup(),
        error = Object.assign(new Error('secret URI and credentials'), {
          name: 'TimeoutError',
          $metadata: { httpStatusCode: 503 },
        });
      if (stage === 'read')
        jest.spyOn(f.repository, 'readForSeal').mockRejectedValue(error);
      if (stage === 'head') f.reader.head.mockRejectedValue(error);
      if (stage === 'stream') f.reader.read.mockRejectedValue(error);
      if (stage === 'seal')
        jest.spyOn(f.repository, 'sealVerified').mockRejectedValue(error);
      let caught: unknown;
      try {
        await f.verifier.verifyAndSeal(f.input);
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({
        name: 'MediaPromotionVerificationError',
        reason: stage === 'seal' ? 'UNCERTAIN' : 'UNAVAILABLE',
      });
      expect(caught).not.toHaveProperty('cause');
      expect(caught).not.toHaveProperty('$metadata');
      expect((caught as Error).message).not.toContain('secret');
    },
  );

  it.each(['journals', 'controls', 'uploads', 'records'] as const)(
    'rolls back MATCH/seal/fences on zero-match %s CAS',
    async (kind) => {
      const f = await setup(),
        before = f.state();
      f.fail(kind, 'updateOne', true);
      await expect(f.seal()).rejects.toThrow();
      expect(f.state()).toEqual(before);
    },
  );

  it('rolls back a tentative seal on an observation identity collision with a previous permission', async () => {
    const f = await setup(),
      before = f.state();
    f.observation.id = f.id(11);
    await expect(f.seal()).rejects.toThrow();
    expect(f.state()).toEqual(before);
  });

  const ticketChanges: Array<[string, (r: PromotionTestRow) => void]> = [
    [
      'counter',
      (r) => {
        r.mediaPromotionRevision = Number(r.mediaPromotionRevision) + 1;
      },
    ],
    [
      'counter absent',
      (r) => {
        delete r.mediaPromotionRevision;
      },
    ],
    [
      'pin',
      (r) => {
        (r.pinned as PromotionTestRow).etag = 'changed';
      },
    ],
    [
      'legacy',
      (r) => {
        r.legacy = { migrationId: 'other' };
      },
    ],
    [
      'sealed',
      (r) => {
        r.sealed = final;
      },
    ],
  ];
  it.each(ticketChanges)(
    'rejects a changed %s ticket captured before verification',
    async (_field, change) => {
      const f = await setup();
      f.change('uploads', (rows) => change(rows[0]));
      const before = f.state();
      await expect(f.seal()).rejects.toThrow();
      expect(f.state()).toEqual(before);
    },
  );

  it.each(['owner', 'version', 'lock', 'token', 'journal', 'mark'] as const)(
    'denies sealing after %s changed without claiming a stable snapshot fence',
    async (change) => {
      const f = await setup();
      if (change === 'journal')
        await f.journal.settleCallback(
          { id: f.selection.operationId, instanceId: f.selection.instanceId },
          'THREW',
          f.upload.createdAt,
        );
      else if (change === 'mark')
        f.change('journals', (rows) => {
          delete rows[0].mediaPromotionProtocol;
        });
      else
        f.change('controls', (rows) => {
          if (change === 'owner') rows[0].ownerId = f.id(99);
          if (change === 'version') rows[0].ownershipVersion = 3;
          if (change === 'lock') rows[0].transferLock = {};
          if (change === 'token') rows[0].activeWrites = [];
        });
      const before = f.state();
      await expect(f.seal()).rejects.toThrow();
      expect(f.state()).toEqual(before);
    },
  );

  it('permits verified observation/seal on a previously revoked gate with a current linked claim', async () => {
    const f = await setup();
    await f.repository.revoke(f.selection, 3, f.audit);
    await f.verifier.verifyAndSeal(f.input);
    expect(f.state().uploads[0].sealed).toEqual(final);
    expect(f.observationRows()).toHaveLength(1);
    expect((await f.repository.read(f.selection)).gate!.data.gate.state).toBe(
      'REVOKED',
    );
    expect(
      (await f.repository.read(f.selection, f.attemptId)).record,
    ).toHaveProperty('authorizationId', f.id(11));
  });

  it('revocation while the body is paused invalidates the captured seal subject', async () => {
    const f = await setup(),
      entered = deferred(),
      resume = deferred();
    async function* body() {
      entered.resolve();
      await bounded(resume.promise, 'verification body');
      yield bytes;
    }
    f.reader.read.mockResolvedValue({
      revision: final,
      body: body(),
      close: f.close,
    });
    const pending = f.verifier.verifyAndSeal(f.input),
      rejected = expect(pending).rejects.toMatchObject({
        stage: 'SEAL',
        reason: 'CONFLICT',
      });
    await bounded(entered.promise, 'verification entered');
    try {
      await f.repository.revoke(f.selection, 3, f.audit);
    } finally {
      resume.resolve();
    }
    await rejected;
    expect(f.observationRows()).toHaveLength(0);
    expect(f.state().uploads[0].sealed).toBeUndefined();
  });

  it('a seal by the current repository wins against a stale seal transaction and rolls back MATCH/fences', async () => {
    const f = await setup(),
      pause = f.pause('uploads'),
      before = f.state();
    const pending = f.seal(),
      rejected = expect(pending).rejects.toThrow();
    await pause.entered;
    try {
      await new MongoAnimalMediaUploadRepository(
        f.models.uploads as never,
      ).seal(f.upload.finalKey, sha256, final);
    } finally {
      pause.resume();
    }
    await rejected;
    expect(f.observationRows()).toHaveLength(0);
    expect(f.state().journals).toEqual(before.journals);
    expect(f.state().controls).toEqual(before.controls);
    expect(f.retries()).toBeGreaterThan(0);
  });

  it('a confirmed seal prevents a fresh SDK retry but preserves a grant already conceded', async () => {
    const f = await setup();
    await f.seal();
    await expect(
      f.repository.apply(f.selection, 4, {
        ...f.intention,
        attemptId: f.id(51),
        origin: 'SDK_RETRY',
        previousAttemptId: f.attemptId,
      }),
    ).rejects.toThrow();
    expect(
      (await f.repository.read(f.selection, f.attemptId)).record,
    ).toHaveProperty('authorizationId', f.id(11));
  });

  it('lost commit reply retains BOTH seal and known observation ID and never automatically replays', async () => {
    const f = await setup();
    // Arm after the read-only subject transaction, before the final write.
    const seal = f.repository.sealVerified.bind(f.repository);
    const spy = jest
      .spyOn(f.repository, 'sealVerified')
      .mockImplementation(async (...args) => {
        f.loseReply();
        await seal(...args);
      });
    await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
      stage: 'SEAL',
      reason: 'UNCERTAIN',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(f.state().uploads[0].sealed).toEqual(final);
    expect(
      (await f.repository.read(f.selection, f.input.observationId)).record,
    ).toMatchObject({ kind: 'OBSERVATION', data: { finding: 'MATCH' } });
    spy.mockRestore();
    await expect(f.seal()).rejects.toThrow();
  });

  it('captures seal inputs before awaiting a session', async () => {
    const f = await setup(),
      pending = f.seal();
    f.subject.effect.data.definition.source.sha256 = 'b'.repeat(64);
    f.observation.revision.etag = 'changed';
    await pending;
    expect(f.state().uploads[0].sealed).toEqual(final);
  });

  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER, '3', true])(
    'rejects corrupt/exhausted counter %j when reading a seal subject',
    async (value) => {
      const f = await setup();
      f.change('uploads', (rows) => {
        rows[0].mediaPromotionRevision = value;
      });
      const before = f.state();
      await expect(f.verifier.verifyAndSeal(f.input)).rejects.toMatchObject({
        stage: 'READ',
        reason: 'CONFLICT',
      });
      expect(f.reader.head).not.toHaveBeenCalled();
      expect(f.state()).toEqual(before);
    },
  );

  it('keeps absent and zero captured ticket counters distinct at seal commit', async () => {
    const f = await setup();
    f.change('uploads', (rows) => {
      rows[0].mediaPromotionRevision = 0;
    });
    const subject = await f.repository.readForSeal(f.selection, f.effectId);
    f.change('uploads', (rows) => {
      delete rows[0].mediaPromotionRevision;
    });
    const before = f.state();
    await expect(
      f.repository.sealVerified(f.selection, subject, f.observation),
    ).rejects.toThrow('ticket fence changed');
    expect(f.state()).toEqual(before);
  });

  it('a seal subject read changes no rows or fences and acquires no permission', async () => {
    const f = await setup(),
      before = f.state(),
      start = f.log.length;
    await f.repository.readForSeal(f.selection, f.effectId);
    expect(f.state()).toEqual(before);
    expect(f.log.slice(start).every((r) => r.method === 'findOne')).toBe(true);
  });

  it('rolls back the tentative ticket seal if inserting observation evidence fails', async () => {
    const f = await setup(),
      before = f.state();
    f.fail('records', 'create');
    await expect(f.seal()).rejects.toThrow();
    expect(f.state()).toEqual(before);
  });

  it('can verify a preexisting matching final without attributing it to an attempt', async () => {
    const f = promotionStoreFixture();
    f.change('uploads', (rows) => {
      (rows[0].pinned as PromotionTestRow).sha256 = sha256;
    });
    await f.repository.open(f.selection);
    await f.repository.apply(f.selection, 0, f.declare);
    const subject = await f.repository.readForSeal(f.selection, f.effectId);
    await f.repository.sealVerified(f.selection, subject, {
      id: f.id(40),
      finding: 'MATCH',
      uploadId: f.upload.id,
      sha256,
      revision: final,
      evidenceRef: 'test:existing-final',
    });
    expect(f.state().uploads[0].sealed).toEqual(final);
    expect(f.state().records.some((r) => r.kind === 'ATTEMPT')).toBe(false);
  });
});
