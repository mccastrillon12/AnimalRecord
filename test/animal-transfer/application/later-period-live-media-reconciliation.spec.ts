import { Readable } from 'node:stream';
import {
  LaterPeriodLiveMediaAuditProducer,
  type LaterPeriodLivePutAuditReader,
} from '../../../src/context/animal-transfer/application/later-period-live-media-evidence-producer';
import {
  LaterPeriodLiveMediaReconciler,
  type LaterPeriodLiveMediaStore,
} from '../../../src/context/animal-transfer/application/later-period-live-media-reconciler';
import { LaterPeriodLivePutCutEvidenceSource } from '../../../src/context/animal-transfer/application/later-period-live-put-cut-evidence-source';
import {
  STABLE_CUT_COVERAGE_GROUPS,
  StableCutInventoryEvidenceReader,
  type StableCutWriterFindings,
  type StableCutWriterInventory,
} from '../../../src/context/animal-transfer/application/stable-cut-writer-evidence';
import { laterPeriodLiveMediaReference } from '../../../src/context/animal-transfer/domain/later-period-stable-cut-copy-evidence';
import {
  laterPeriodLivePutEffect,
  type LaterPeriodLivePutEffect,
} from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import type { LaterPeriodStableCutScope } from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import type { ItemSourceRetentionReader } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import type { ItemHistoricalPutVersionReader } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

async function setup() {
  const f = await publishedLaterPeriod('processing');
  const { scope, liveMediaEvidence, accreditationHash } = f.live.record;
  const scopeHash = archiveHash(scope);
  const effects = {
    historical: laterPeriodLivePutEffect(
      scope,
      {
        fileId: scope.fileId,
        expectedScopeHash: scopeHash,
        leg: 'HISTORICAL',
      },
      f.live.historicalPut,
    ),
    final: laterPeriodLivePutEffect(
      scope,
      {
        fileId: scope.fileId,
        expectedScopeHash: scopeHash,
        leg: 'FINAL',
      },
      f.live.finalPut,
    ),
  };
  const pins = {
    fileId: scope.fileId,
    expectedScopeHash: scopeHash,
    expectedPreviousEvidenceHash: null,
    requiredThrough: f.commitSelection.retainedSelection.requiredThrough,
  };
  const { bucket, expectedBucketOwner } = effects.historical.target;
  const location = { bucket, expectedBucketOwner };
  const observed = {
    scope,
    scopeHash,
    currentEvidenceHash: null as string | null,
  };
  const register = jest.fn<
    ReturnType<LaterPeriodLiveMediaStore['register']>,
    Parameters<LaterPeriodLiveMediaStore['register']>
  >((...[, selection, evidence]) =>
    Promise.resolve({
      evidenceHash: selection.expectedEvidenceHash,
      recordedAt: f.now().toISOString(),
      replayed: evidence === undefined,
      businessCommit: 'NOT_AUTHORIZED',
    }),
  );
  const store = {
    observe: jest.fn().mockResolvedValue(observed),
    readCopyEffects: jest.fn().mockResolvedValue(effects),
    register,
  } satisfies LaterPeriodLiveMediaStore;
  const audited = (effect: LaterPeriodLivePutEffect) => ({
    effectHash: archiveHash(effect),
    operation: 'PUT_OBJECT' as const,
    outcome: 'APPLIED' as const,
    revision:
      effect.target.key === scope.historicalKey
        ? liveMediaEvidence.historical.revision
        : liveMediaEvidence.final.revision,
    occurredAt: '2026-10-29T12:02:30.000Z',
    eventEvidenceHash: archiveHash(['event', effect.target.key]),
  });
  const audit = {
    readAppliedVersion: jest.fn<
      ReturnType<LaterPeriodLivePutAuditReader['readAppliedVersion']>,
      Parameters<LaterPeriodLivePutAuditReader['readAppliedVersion']>
    >((effect) => Promise.resolve(audited(effect))),
  } satisfies LaterPeriodLivePutAuditReader;
  const retainUntil = '2026-10-29T12:08:00.000Z';
  const retention = {
    readSourceRetention: jest.fn<
      ReturnType<ItemSourceRetentionReader['readSourceRetention']>,
      Parameters<ItemSourceRetentionReader['readSourceRetention']>
    >(({ key }) =>
      Promise.resolve({
        mode: 'COMPLIANCE',
        expectedBucketOwner,
        reportedRetainUntil:
          key === scope.finalKey ? retainUntil : '2026-10-29T12:10:00.000Z',
      }),
    ),
  };
  const close = jest.fn();
  const versions = {
    readVersion: jest.fn<
      ReturnType<ItemHistoricalPutVersionReader['readVersion']>,
      Parameters<ItemHistoricalPutVersionReader['readVersion']>
    >((...[, revision]) =>
      Promise.resolve({
        revision,
        body: Readable.from([f.live.bytes]),
        close,
      }),
    ),
  };
  const reports = { read: jest.fn().mockResolvedValue(null) };
  const producer = new LaterPeriodLiveMediaAuditProducer(
    f.recipientId,
    audit,
    retention,
    {
      ...location,
      controlsHash: archiveHash('synthetic conservation controls'),
    },
    f.now,
  );
  const service = new LaterPeriodLiveMediaReconciler(
    store,
    reports,
    versions,
    location,
    f.now,
  );
  const item = f.commitSelection.selector;
  return {
    dossier: f,
    item,
    pins,
    service,
    producer,
    store,
    effects,
    audited,
    audit,
    retention,
    versions,
    close,
    reports,
    scope,
    liveMediaEvidence,
    accreditationHash,
    observed,
    location,
    retainUntil,
  };
}

describe('Live PUT findings for the stable-cut collector', () => {
  async function collection() {
    const f = await setup();
    const { retainedScope, retainedFiles, jointScope } = f.dossier;
    const evidence = await f.producer.produce(
      f.scope,
      f.effects,
      jointScope.requiredThrough,
    );
    f.store.observe.mockResolvedValue({
      ...f.observed,
      currentEvidenceHash: archiveHash(evidence),
    });
    f.audit.readAppliedVersion.mockClear();
    f.retention.readSourceRetention.mockClear();
    const liveMedia = [{ fileId: f.scope.fileId, evidence }];
    const reference = laterPeriodLiveMediaReference(f.scope.fileId, evidence);
    const { scopeHash: originalScopeHash, ...original } = jointScope;
    const facts = {
      ...original,
      liveMediaDigest: archiveHash([reference]),
      liveProjectionHash: archiveHash([originalScopeHash, reference]),
      conservationControlsHashes: [
        ...new Set([
          ...retainedScope.retained.conservationControlsHashes,
          evidence.historical.conservationControlsHash,
          evidence.final.conservationControlsHash,
        ]),
      ].sort(),
    };
    const scope = {
      ...facts,
      scopeHash: archiveHash(facts),
    } satisfies LaterPeriodStableCutScope;
    const liveIds = [
      f.effects.historical.permissionHash,
      f.effects.final.permissionHash,
    ];
    const retainedIds = retainedFiles.flatMap(({ attempts }) =>
      attempts.map(({ permissionHash }) => permissionHash),
    );
    const controlsHash = archiveHash('authoritative writer controls');
    const scopeBinding = {
      scopeHash: scope.scopeHash,
      controlsHash,
      validFrom: '2026-10-29T12:00:00.000Z',
      validUntil: '2026-10-29T12:15:00.000Z',
    };
    const inventory = {
      ...scopeBinding,
      groups: Object.fromEntries(
        STABLE_CUT_COVERAGE_GROUPS.map((group) => [
          group,
          {
            completenessEvidenceHash: archiveHash([
              group,
              'complete inventory attestation',
            ]),
            identityHashes:
              group === 'copyEffects' ? [...retainedIds, ...liveIds] : [],
          },
        ]),
      ) as unknown as StableCutWriterInventory['groups'],
    };
    const otherGroups = Object.fromEntries(
      STABLE_CUT_COVERAGE_GROUPS.map((group) => [
        group,
        group === 'copyEffects'
          ? retainedIds.map((identityHash) => ({
              identityHash,
              disposition: 'ISOLATED',
              evidenceHash: archiveHash([
                identityHash,
                'independent isolation',
              ]),
            }))
          : [],
      ]),
    ) as unknown as StableCutWriterFindings['groups'];
    const authority = {
      readInventory: jest.fn(() => Promise.resolve(inventory)),
      readOtherFindings: jest.fn(
        (
          _scope: LaterPeriodStableCutScope,
          _controls: string,
          writerInventoryHash: string,
        ) =>
          Promise.resolve({
            ...scopeBinding,
            writerInventoryHash,
            groups: otherGroups,
          } as StableCutWriterFindings | null),
      ),
    };
    const source = new LaterPeriodLivePutCutEvidenceSource(
      {
        item: f.item,
        scope,
        laterCopyEvidence: {
          retainedBinding: retainedScope.binding,
          retainedFiles,
          liveMedia,
        },
      },
      authority,
      f.store,
      f.producer,
    );
    const reader = new StableCutInventoryEvidenceReader(source);
    return {
      ...f,
      scope,
      liveIds,
      retainedIds,
      controlsHash,
      authority,
      collect: () => reader.readVerifiedEvidence(scope, controlsHash),
    };
  }

  it('combines re-audited live PUTs with independent retained findings and inventory', async () => {
    const f = await collection();
    const result = await f.collect();
    if (!result) throw new Error('Expected checked findings');
    expect(f.authority.readOtherFindings).toHaveBeenCalledWith(
      f.scope,
      f.controlsHash,
      result.findings.writerInventoryHash,
      f.liveIds,
    );
    expect(
      result.findings.groups.copyEffects.map(
        ({ identityHash }) => identityHash,
      ),
    ).toEqual([...f.liveIds, ...f.retainedIds].sort());
    expect(result.findings.validUntil).toBe(f.retainUntil);
    expect(f.audit.readAppliedVersion.mock.calls).toEqual([
      [f.effects.historical],
      [f.effects.final],
    ]);
    expect(f.store.register).not.toHaveBeenCalled();
  });

  it('keeps the same findings if the original version retention was extended', async () => {
    const f = await collection();
    const before = await f.collect();
    expect(before).not.toBeNull();
    f.retention.readSourceRetention.mockResolvedValue({
      ...f.location,
      mode: 'COMPLIANCE',
      reportedRetainUntil: '2026-10-29T12:12:00.000Z',
    });
    await expect(f.collect()).resolves.toEqual(before);
  });

  it('requires the remaining independent findings before reading the live audit', async () => {
    const f = await collection();
    f.authority.readOtherFindings.mockResolvedValueOnce(null);
    await expect(f.collect()).resolves.toBeNull();
    expect(f.audit.readAppliedVersion).not.toHaveBeenCalled();
  });

  it('stops before remote reads when the original permit changes', async () => {
    const f = await collection();
    f.store.readCopyEffects.mockResolvedValueOnce({
      ...f.effects,
      final: {
        ...f.effects.final,
        permissionHash: archiveHash('another permission'),
      },
    });
    await expect(f.collect()).rejects.toThrow(
      'do not match the selected stable cut',
    );
    expect(f.audit.readAppliedVersion).not.toHaveBeenCalled();
  });

  it('blocks the pair when an independently recorded PUT cannot be found again', async () => {
    const f = await collection();
    f.audit.readAppliedVersion.mockResolvedValueOnce(null);
    await expect(f.collect()).rejects.toThrow('is unconfirmed');
    expect(f.store.register).not.toHaveBeenCalled();
  });
});

describe('Reconciliation of already permitted later-period copies', () => {
  it('uses separate audited writes and verifies the three versioned byte streams before recording evidence', async () => {
    const f = await setup();
    const result = await f.service.reconcilePermitted(
      f.item,
      f.pins,
      f.producer,
    );
    const { historical, final } = f.effects;
    const historicalVersion = f.audited(historical).revision;
    const finalVersion = f.audited(final).revision;
    expect(f.audit.readAppliedVersion.mock.calls).toEqual([
      [historical],
      [final],
    ]);
    expect(f.retention.readSourceRetention.mock.calls).toEqual([
      [
        {
          bucket: f.location.bucket,
          key: historical.target.key,
          versionId: historicalVersion.versionId,
        },
      ],
      [
        {
          bucket: f.location.bucket,
          key: final.target.key,
          versionId: finalVersion.versionId,
        },
      ],
    ]);
    expect(f.versions.readVersion.mock.calls).toEqual([
      [{ ...f.location, key: f.scope.source.key }, f.scope.source.revision],
      [historical.target, historicalVersion],
      [final.target, finalVersion],
    ]);
    expect(f.close).toHaveBeenCalledTimes(3);
    expect(f.store.register).toHaveBeenCalledTimes(1);
    const [, pins, evidence] = f.store.register.mock.calls[0];
    expect(evidence).toMatchObject({
      historical: { target: historical.target, revision: historicalVersion },
      final: { target: final.target, revision: finalVersion },
      copyPermissionHashes: {
        historical: historical.permissionHash,
        final: final.permissionHash,
      },
      validUntil: f.retainUntil,
    });
    expect(pins.expectedEvidenceHash).toBe(archiveHash(evidence));
    expect(result).toMatchObject({
      evidenceHash: pins.expectedEvidenceHash,
      replayed: false,
      businessCommit: 'NOT_AUTHORIZED',
    });
  });

  it('rejects one audit event reused for two permissions before reading retention or bytes', async () => {
    const f = await setup();
    f.audit.readAppliedVersion
      .mockResolvedValueOnce(f.audited(f.effects.historical))
      .mockResolvedValueOnce({
        ...f.audited(f.effects.final),
        eventEvidenceHash: f.audited(f.effects.historical).eventEvidenceHash,
      });
    await expect(
      f.service.reconcilePermitted(f.item, f.pins, f.producer),
    ).rejects.toThrow(
      'exact version written by the permitted live PUT is unconfirmed',
    );
    expect(f.retention.readSourceRetention).not.toHaveBeenCalled();
    expect(f.versions.readVersion).not.toHaveBeenCalled();
    expect(f.store.register).not.toHaveBeenCalled();
  });

  it('leaves the copies unconfirmed when one permitted write has no audit event', async () => {
    const f = await setup();
    f.audit.readAppliedVersion
      .mockResolvedValueOnce(f.audited(f.effects.historical))
      .mockResolvedValueOnce(null);
    await expect(
      f.service.reconcilePermitted(f.item, f.pins, f.producer),
    ).rejects.toThrow(
      'exact version written by the permitted live PUT is unconfirmed',
    );
    expect(f.retention.readSourceRetention).not.toHaveBeenCalled();
    expect(f.versions.readVersion).not.toHaveBeenCalled();
    expect(f.store.register).not.toHaveBeenCalled();
  });

  it('rejects the reuse of a transport attempt before involving the audit producer', async () => {
    const f = await setup();
    f.store.readCopyEffects.mockResolvedValue({
      ...f.effects,
      final: {
        ...f.effects.final,
        transportRequestHash: f.effects.historical.transportRequestHash,
      },
    });
    await expect(
      f.service.reconcilePermitted(f.item, f.pins, f.producer),
    ).rejects.toThrow('live PUT selection or evidence is inconsistent');
    expect(f.audit.readAppliedVersion).not.toHaveBeenCalled();
    expect(f.store.register).not.toHaveBeenCalled();
  });

  it.each(['digest', 'target'] as const)(
    'rejects an independently formatted report with a different %s before reading the bytes',
    async (field) => {
      const f = await setup();
      const original = f.liveMediaEvidence;
      const sha256 = archiveHash('other bytes');
      const report =
        field === 'digest'
          ? {
              ...original,
              historical: { ...original.historical, sha256 },
              final: { ...original.final, sha256 },
            }
          : {
              ...original,
              final: {
                ...original.final,
                target: {
                  ...original.final.target,
                  expectedBucketOwner: '222222222222',
                },
              },
            };
      await expect(
        f.service.reconcilePermitted(f.item, f.pins, {
          produce: () => Promise.resolve(report),
        }),
      ).rejects.toThrow(
        'produced live media report differs from the permitted effects',
      );
      expect(f.versions.readVersion).not.toHaveBeenCalled();
      expect(f.store.register).not.toHaveBeenCalled();
    },
  );

  it('replays the exact stored report through local registration without fetching audit or bytes', async () => {
    const f = await setup();
    f.store.observe.mockResolvedValue({
      ...f.observed,
      currentEvidenceHash: f.accreditationHash,
    });
    const pins = { ...f.pins, expectedEvidenceHash: f.accreditationHash };
    await expect(f.service.reconcile(f.item, pins)).resolves.toMatchObject({
      evidenceHash: f.accreditationHash,
      replayed: true,
    });
    expect(f.reports.read).not.toHaveBeenCalled();
    expect(f.store.readCopyEffects).not.toHaveBeenCalled();
    expect(f.versions.readVersion).not.toHaveBeenCalled();
    expect(f.store.register).toHaveBeenCalledWith(f.item, pins);
  });
});
