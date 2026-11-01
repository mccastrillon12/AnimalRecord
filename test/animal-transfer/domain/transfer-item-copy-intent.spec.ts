import {
  ItemCopyIntentContext,
  ItemHistoricalCopyObservation,
  buildItemHistoricalCopyIntent,
  buildItemStagingCopyIntent,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ItemCaptureSnapshot } from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

async function fixture() {
  const f = acceptanceStartStore();
  const receipt = await f.service.start(f.input);
  const selected = receipt.binding.selected[0];
  const archive = f.state.db.archives[0] as unknown as OwnershipArchive;
  Object.assign(archive, {
    state: 'COPYING',
    capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
    expectedEntryCount: 1,
    expectedFileCount: 1,
  });
  const key = `users/${archive.ownerId}/animals/${archive.animalId}/profile/photo.jpg`;
  const built = buildArchiveEntry(
    archive,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: archive.animalId,
        ownerId: archive.ownerId,
        profilePictureUrl: `https://test/${key}`,
      },
    },
    (url) => url.slice(13),
  );
  const definition = {
    ...built.files[0],
    source: { etag: 'source-etag', size: 12, versionId: 'source-v1' },
  };
  const file: ArchiveFile = {
    ...definition,
    definitionHash: archiveHash(definition),
    state: 'PENDING',
  };
  const context: ItemCopyIntentContext = {
    selector: {
      actorId: f.recipientId,
      transferId: f.input.transferId,
      itemId: selected.itemId,
      decisionOperationId: f.input.operationId,
      expectedRequestVersion: 2,
      expectedCaptureRevision: 3,
    },
    snapshot: {
      request: f.state.db.requests[0],
      item: f.state.db.items[0],
      claim: f.state.db.claims[0],
      archive,
      control: f.state.db.controls[0],
    } as ItemCaptureSnapshot,
    file,
    bucket: 'test-archive-bucket',
    sourceSha256: 'a'.repeat(64),
  };
  const historical = buildItemHistoricalCopyIntent(context);
  const observation: ItemHistoricalCopyObservation = {
    intentId: historical.id,
    intentDefinitionHash: historical.definitionHash,
    bucket: historical.bucket,
    key: historical.destination.key,
    revision: { etag: 'history-etag', size: 12, versionId: 'history-v1' },
    sha256: context.sourceSha256,
  };
  return { context, historical, observation, f };
}

describe('Pure per-item historical/staging copy definitions, without permission or I/O', () => {
  it('pins the original item/seal/manifest, explicit bucket, bytes and conditional historical destination', async () => {
    const { context, historical, f } = await fixture();
    const before = structuredClone(context);
    const writes = f.state.writes;
    expect(historical).toMatchObject({
      protocol: 'ITEM_ARCHIVE_COPY_INTENT_V1',
      kind: 'HISTORICAL',
      binding: {
        transferId: context.selector.transferId,
        itemId: context.selector.itemId,
        requestVersion: 2,
        observedSeal: { reservationEpoch: 1, captureRevision: 3 },
        fileId: context.file.id,
        fileDefinitionHash: context.file.definitionHash,
      },
      bucket: context.bucket,
      source: {
        key: context.file.sourceKey,
        revision: context.file.source,
        sha256: context.sourceSha256,
      },
      destination: { key: context.file.historicalKey, ifNoneMatch: '*' },
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(historical.id).toMatch(/^[a-f0-9]{64}$/);
    const { definitionHash, ...definition } = historical;
    expect(definitionHash).toBe(archiveHash(definition));
    expect(historical).not.toHaveProperty('predecessor');
    expect(buildItemHistoricalCopyIntent(context)).toEqual(historical);
    expect(context).toEqual(before);
    expect(f.state.writes).toBe(writes);
  });
  it('binds staging to the historical revision/digest and exact predecessor observation', async () => {
    const { context, historical, observation } = await fixture();
    const staging = buildItemStagingCopyIntent(
      context,
      historical,
      observation,
    );
    expect(staging).toMatchObject({
      kind: 'RECIPIENT_STAGING',
      source: {
        key: context.file.historicalKey,
        revision: observation.revision,
        sha256: observation.sha256,
      },
      destination: { key: context.file.recipientStagingKey, ifNoneMatch: '*' },
      predecessor: {
        intentId: historical.id,
        intentDefinitionHash: historical.definitionHash,
        observationHash: archiveHash(observation),
      },
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(staging.id).not.toBe(historical.id);
    const { definitionHash, ...definition } = staging;
    expect(definitionHash).toBe(archiveHash(definition));
    expect(
      buildItemStagingCopyIntent(context, historical, observation),
    ).toEqual(staging);
    expect(staging.destination.key).not.toBe(context.file.recipientFinalKey);
  });
  it('detaches and deeply freezes both definitions from caller mutations', async () => {
    const { context, historical, observation } = await fixture();
    const staging = buildItemStagingCopyIntent(
      context,
      historical,
      observation,
    );
    context.file.source.etag = 'changed';
    observation.revision.etag = 'changed';
    context.snapshot.archive!.capture!.revision = 99;
    expect(historical.source.revision.etag).toBe('source-etag');
    expect(staging.source.revision.etag).toBe('history-etag');
    expect(historical.binding.observedSeal.captureRevision).toBe(3);
    for (const intent of [historical, staging]) {
      for (const value of [
        intent,
        intent.binding,
        intent.binding.observedSeal,
        intent.source,
        intent.source.revision,
        intent.destination,
      ])
        expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(staging.predecessor)).toBe(true);
    expect(JSON.stringify(staging)).not.toMatch(
      /Brownie|payload|https:|leaseToken|authorizationId/,
    );
  });
  it('distinguishes definition conflicts from logical identity and ignores operational leases', async () => {
    const { context, historical } = await fixture();
    for (const changed of [
      { ...context, bucket: 'another-bucket' },
      { ...context, sourceSha256: 'b'.repeat(64) },
    ]) {
      const intent = buildItemHistoricalCopyIntent(changed);
      expect(intent.id).toBe(historical.id);
      expect(intent.definitionHash).not.toBe(historical.definitionHash);
    }
    context.file.state = 'COPYING';
    context.file.leaseToken = 'private-worker';
    context.file.leaseUntil = '2000-01-01T00:00:00Z';
    expect(buildItemHistoricalCopyIntent(context)).toEqual(historical);
  });
  it('does not require VersionId for a definition or infer preservation from one', async () => {
    const { context, observation } = await fixture();
    delete context.file.source.versionId;
    const {
      definitionHash: _hash,
      state: _state,
      ...definition
    } = context.file;
    expect(_hash).toHaveLength(64);
    expect(_state).toBe('PENDING');
    context.file.definitionHash = archiveHash(definition);
    const intent = buildItemHistoricalCopyIntent(context);
    expect(intent.source.revision).not.toHaveProperty('versionId');
    const obs = {
      ...observation,
      intentId: intent.id,
      intentDefinitionHash: intent.definitionHash,
    };
    delete obs.revision.versionId;
    expect(buildItemStagingCopyIntent(context, intent, obs).retention).toBe(
      'NOT_ASSESSED',
    );
    expect(intent.copyDispatch).toBe('NOT_AUTHORIZED');
  });
  it.each([
    'bucket',
    'bucketMissing',
    'digest',
    'fileId',
    'fileHash',
    'foreignArchive',
    'source',
    'history',
    'staging',
    'activeFinal',
    'traversal',
    'retained',
    'missingRevision',
    'emptyVersion',
    'badEtag',
    'size',
    'unknownRevisionField',
  ])('rejects inconsistent local file inputs: %s', async (kind) => {
    const { context } = await fixture();
    const file = context.file;
    const changed = { ...context };
    if (kind === 'bucket') changed.bucket = 'https://example.com/bucket';
    if (kind === 'bucketMissing') changed.bucket = '';
    if (kind === 'digest') changed.sourceSha256 = 'bad';
    if (kind === 'fileId') file.id = 'a'.repeat(64);
    if (kind === 'fileHash') file.definitionHash = 'b'.repeat(64);
    if (kind === 'foreignArchive') file.archiveId = context.selector.transferId;
    if (kind === 'source') file.sourceKey = file.historicalKey;
    if (kind === 'history') file.historicalKey = file.recipientFinalKey;
    if (kind === 'staging') file.recipientStagingKey = file.recipientFinalKey;
    if (kind === 'activeFinal') file.recipientFinalKey = file.historicalKey;
    if (kind === 'traversal') file.relativeKey = '../photo.jpg';
    if (kind === 'retained') file.retained = {} as never;
    if (kind === 'missingRevision') file.source = undefined as never;
    if (kind === 'emptyVersion') file.source.versionId = '';
    if (kind === 'badEtag') file.source.etag = 'value\r\nInjected';
    if (kind === 'size') file.source.size = 0;
    if (kind === 'unknownRevisionField')
      (file.source as unknown as Record<string, unknown>).grant = true;
    // A self-consistent hash must not make a foreign destination/source valid.
    if (
      ['source', 'history', 'staging', 'activeFinal', 'traversal'].includes(
        kind,
      )
    ) {
      file.id = archiveHash([file.archiveId, file.sourceKey]);
      file.definitionHash = archiveHash({
        id: file.id,
        archiveId: file.archiveId,
        sourceKey: file.sourceKey,
        relativeKey: file.relativeKey,
        historicalKey: file.historicalKey,
        recipientStagingKey: file.recipientStagingKey,
        recipientFinalKey: file.recipientFinalKey,
        source: file.source,
      });
    }
    expect(() => buildItemHistoricalCopyIntent(changed)).toThrow();
  });
  it.each([
    'stale',
    'claim',
    'epoch',
    'consumed',
    'legacy',
    'emptyManifest',
    'unsealed',
  ])('preserves the original capture guards: %s', async (kind) => {
    const { context } = await fixture();
    const selector = { ...context.selector };
    if (kind === 'stale') selector.expectedCaptureRevision = 2;
    if (kind === 'claim') context.snapshot.claim!.transferId = selector.itemId;
    if (kind === 'epoch') context.snapshot.control!.reservationEpoch = 3;
    if (kind === 'consumed')
      context.snapshot.archive!.evidenceConsumption = {} as never;
    if (kind === 'legacy') delete context.snapshot.archive!.reservation;
    if (kind === 'emptyManifest')
      context.snapshot.archive!.expectedFileCount = 0;
    if (kind === 'unsealed') context.snapshot.archive!.state = 'COLLECTING';
    expect(() =>
      buildItemHistoricalCopyIntent({ ...context, selector }),
    ).toThrow();
  });
  it.each([
    'missing',
    'intentId',
    'intentHash',
    'bucket',
    'key',
    'digest',
    'size',
    'revision',
    'extra',
  ])(
    'requires an explicit matching historical observation for staging: %s',
    async (kind) => {
      const { context, historical, observation } = await fixture();
      if (kind === 'intentId')
        Object.assign(observation, { intentId: 'a'.repeat(64) });
      if (kind === 'intentHash')
        Object.assign(observation, { intentDefinitionHash: 'b'.repeat(64) });
      if (kind === 'bucket')
        Object.assign(observation, { bucket: 'another-bucket' });
      if (kind === 'key')
        Object.assign(observation, { key: context.file.recipientStagingKey });
      if (kind === 'digest')
        Object.assign(observation, { sha256: 'b'.repeat(64) });
      if (kind === 'size') observation.revision.size = 13;
      if (kind === 'revision') observation.revision.etag = '';
      if (kind === 'extra')
        Object.assign(observation, { copyDispatch: 'AUTHORIZED' });
      context.file.state = 'VERIFIED';
      expect(() =>
        buildItemStagingCopyIntent(
          context,
          historical,
          kind === 'missing' ? (undefined as never) : observation,
        ),
      ).toThrow();
    },
  );
  it('rejects a rehashed foreign destination or unsupported permission in the predecessor', async () => {
    const { context, historical, observation } = await fixture();
    const { definitionHash: _hash, ...definition } = historical;
    expect(_hash).toHaveLength(64);
    for (const changed of [
      {
        ...definition,
        destination: {
          key: context.file.recipientFinalKey,
          ifNoneMatch: '*' as const,
        },
      },
      { ...definition, copyDispatch: 'AUTHORIZED' },
    ]) {
      const invalid = { ...changed, definitionHash: archiveHash(changed) };
      expect(() =>
        buildItemStagingCopyIntent(context, invalid as never, observation),
      ).toThrow();
    }
  });
});
