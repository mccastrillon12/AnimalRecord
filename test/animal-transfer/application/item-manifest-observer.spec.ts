import { createHash } from 'node:crypto';
import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../../src/context/animal-transfer/application/item-manifest-preparer';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import type { ItemCopyAttemptRecord } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import {
  ItemArchiveCopyIntent,
  captureItemArchiveFileDefinition,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  ItemSourceByteObservation,
  ItemFixedSourceReader,
  ItemSourceProfileRecord,
  ItemSourceLastReadBound,
  ItemSourceProfileObservationSet,
  ItemSourceRetentionReader,
  ItemSourceRetentionTarget,
  buildItemSourceRetentionObservation,
  buildItemFixedSourceObservation,
  buildItemSourceDelegationBound,
  buildItemSourceProfileObservation,
  buildItemSourceStorageObservation,
  matchItemSourceProfileObservationSet,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import {
  ItemSourceArtifactIdentity,
  ItemSourceArtifactSeal,
  OpenItemSourceArtifact,
  buildItemSourceArtifactSeal,
} from '../../../src/context/animal-transfer/domain/transfer-item-source-artifact';
import { OwnershipArchiveFileSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { MongoItemSourceProfileState } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { InMemoryItemSourceArtifactCustody } from '../../../src/context/animal-transfer/infrastructure/storage/in-memory-item-source-artifact-custody';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { itemManifestFixture } from '../fixtures/item-manifest.fixture';

async function setup(count = 1, files = true) {
  const t = await itemManifestFixture(count, files);
  const read = jest.spyOn(t.f.store, 'readManifestPage');
  const observer = new ItemManifestObserver(t.f.store, t.keyFromUrl);
  return { ...t, read, observer };
}
describe('Controlled local item manifest observation with simulated Mongo', () => {
  it('traverses more than 100 entries/files and revalidates COMPLETE in separate read-only transactions', async () => {
    const t = await setup(203),
      before = structuredClone(t.f.state.db),
      from = t.f.sessions.length;
    expect(await t.observer.observe(t.input)).toEqual(t.complete());
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'FILES',
      'FILES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.f.sessions.slice(from)).toHaveLength(9);
    for (const session of t.f.sessions.slice(from))
      expect(session.endSession).toHaveBeenCalledTimes(1);
    const reads = t.f.calls.filter(
      (c) => c.role === 'entries' || c.role === 'files',
    );
    expect(reads).toHaveLength(8);
    expect(
      reads.every((c) => c.options?.singleBatch === true && c.limit === 100),
    ).toBe(true);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('continues after server-sized short batches until actual empty pages rather than treating fewer than 100 as terminal', async () => {
    const t = await setup(7);
    t.f.state.manifestBatchSize = 2;
    expect(await t.observer.observe(t.input)).toEqual(t.complete());
    expect(t.read).toHaveBeenCalledTimes(11);
    expect(t.read.mock.calls[1][0].cursor.afterId).toBe(t.entries[1].id);
    expect(t.read.mock.calls[6][0].cursor.afterId).toBe(t.files[1].id);
  });
  it('reads an empty file page and a final snapshot even when the cut declares zero files', async () => {
    const t = await setup(1, false);
    expect(await t.observer.observe(t.input)).toMatchObject({
      entryCount: 1,
      fileCount: 0,
      reservation: 'OBSERVED_ONLY',
      stableCut: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(t.read.mock.calls.map(([i]) => i.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'COMPLETE',
    ]);
  });
  it.each(['epoch', 'claim', 'request', 'capture', 'period'] as const)(
    'does not return a digest after original %s invalidation between pages',
    async (kind) => {
      const t = await setup(3),
        read = t.read.getMockImplementation()!.bind(t.f.store);
      t.read.mockImplementationOnce(async (input) => {
        const page = await read(input);
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          t.f.state.db.claims[0].acceptanceOperationId = t.f.id(90);
        if (kind === 'request') t.f.state.db.requests[0].version = 3;
        if (kind === 'capture')
          (t.f.state.db.archives[0].capture as { revision: number }).revision++;
        if (kind === 'period') t.f.state.db.periods = [];
        return page;
      });
      await expect(t.observer.observe(t.input)).rejects.toThrow();
      expect(t.read).toHaveBeenCalledTimes(2);
      expect(t.f.state.writes).toBe(0);
      expect(t.f.state.db.archives[0].manifestDigest).toBeUndefined();
    },
  );
  it('revalidates after the terminal file page instead of finishing from its older snapshot', async () => {
    const t = await setup(),
      read = t.read.getMockImplementation()!.bind(t.f.store);
    t.read.mockImplementation(async (input) => {
      const page = await read(input);
      if (page.phase === 'FILES' && page.rows.length === 0)
        t.f.state.db.controls[0].reservationEpoch = 3;
      return page;
    });
    await expect(t.observer.observe(t.input)).rejects.toThrow(
      'original matching',
    );
    expect(t.read.mock.calls.at(-1)![0].cursor.phase).toBe('COMPLETE');
    expect(t.f.state.writes).toBe(0);
  });
  it('discards the local accumulator on read failure without persisting or retrying another page', async () => {
    const t = await setup(),
      read = t.read.getMockImplementation()!.bind(t.f.store),
      failure = new Error('Trusted reader failure');
    t.read.mockImplementationOnce(read).mockRejectedValueOnce(failure);
    const before = structuredClone(t.f.state.db);
    await expect(t.observer.observe(t.input)).rejects.toBe(failure);
    expect(t.read).toHaveBeenCalledTimes(2);
    expect(t.f.state.db).toEqual(before);
  });
  it('rejects payload corruption before traversing files and leaves stored state untouched', async () => {
    const t = await setup();
    t.f.state.db.entries[0].contentHash = 'b'.repeat(64);
    const before = structuredClone(t.f.state.db);
    await expect(t.observer.observe(t.input)).rejects.toThrow('integrity');
    expect(t.read).toHaveBeenCalledTimes(1);
    expect(t.f.state.db).toEqual(before);
  });
  it('rejects a mismatched reader phase instead of treating it as completion', async () => {
    const t = await setup();
    t.read.mockResolvedValueOnce({ phase: 'COMPLETE', snapshot: t.snapshot });
    await expect(t.observer.observe(t.input)).rejects.toThrow(
      'another traversal phase',
    );
    expect(t.read).toHaveBeenCalledTimes(1);
  });
  it('captures original input before the first await and returns a frozen minimal result', async () => {
    const t = await setup(),
      expected = t.complete(),
      raw = structuredClone(t.input);
    const pending = t.observer.observe(raw);
    raw.selector.itemId = t.f.id(90);
    raw.expectedSealHash = 'b'.repeat(64);
    const result = await pending;
    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|payload|Brownie|leaseToken|sourceKey|sha256/,
    );
  });
  it('rejects a supplied result or cursor instead of resuming a JSON proof', async () => {
    const t = await setup();
    await expect(
      t.observer.observe({ ...t.input, cursor: { phase: 'FILES' } } as never),
    ).rejects.toThrow('Invalid');
    await expect(
      t.observer.observe({ ...t.input, manifestHash: 'a'.repeat(64) } as never),
    ).rejects.toThrow('Invalid');
    expect(t.read).not.toHaveBeenCalled();
  });
});

describe('Historical source anchor with simulated Mongo and synthetic observations', () => {
  const sourceBytes = Buffer.from('animal-bytes');
  async function anchorSetup(count = 3, versionId: string | null = 'v1') {
    const t = await setup(count);
    const file = t.files.at(-1)!;
    const currentFile = () =>
      t.f.state.db.files.find((row) => row.id === file.id)!;
    if (versionId !== file.source.versionId) {
      const original = captureItemArchiveFileDefinition(t.archive, file);
      const { etag, size } = original.source;
      const source = {
        etag,
        size,
        ...(versionId === null ? {} : { versionId }),
      };
      const changed = {
        source,
        definitionHash: archiveHash({ ...original, source }),
      };
      Object.assign(file, changed);
      Object.assign(currentFile(), changed);
    }
    const preparation = {
      ...t.f.input,
      ...t.input,
      sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
      fileId: file.id,
      expectedFileDefinitionHash: file.definitionHash,
    };
    const header = () =>
      t.f.state.db.archives.find((row) => row.id === file.archiveId)!;
    const digest = t.complete();
    await t.f.store.confirmManifestDigest(t.input, digest);
    await t.f.store.prepareHistoricalCopy(preparation);
    const intent = currentFile().historicalCopyIntent as ItemArchiveCopyIntent;
    const observation = {
      intentId: intent.id,
      intentDefinitionHash: intent.definitionHash,
      bucket: intent.bucket,
      key: intent.source.key,
      revision: intent.source.revision,
      sha256: intent.source.sha256,
    };
    const source: ItemSourceByteObservation = {
      protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
      binding: intent.binding,
      observation,
      observationHash: archiveHash(observation),
      bytes: 'MATCH',
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    };
    await t.f.store.confirmSourceObservation(preparation, source);
    const readSource = jest.spyOn(t.f.store, 'readHistoricalSourceForAnchor');
    t.f.state.writes = 0;
    t.f.calls.length = 0;
    return {
      ...t,
      currentFile,
      header,
      digest,
      intent,
      source,
      readSource,
      anchorInput: { preparation, expectedManifestHash: digest.manifestHash },
    };
  }

  const observedAt = '2026-11-07T15:00:00.000Z';
  const retention = {
    expectedBucketOwner: '123456789012',
    mode: 'COMPLIANCE',
    reportedRetainUntil: '2027-01-01T00:00:00.000Z',
  } as const;
  function withRetention(
    t: Awaited<ReturnType<typeof anchorSetup>>,
    reader: ItemSourceRetentionReader,
    now = () => new Date(observedAt),
  ) {
    return new ItemManifestObserver(t.f.store, t.keyFromUrl, { reader, now });
  }

  function fixedRead(t: Awaited<ReturnType<typeof anchorSetup>>) {
    return {
      revision: t.intent.source.revision,
      expectedBucketOwner: retention.expectedBucketOwner,
      mode: 'COMPLIANCE',
      eventHold: 'OFF',
      fixedRetainUntil: retention.reportedRetainUntil,
      body: (async function* () {
        await Promise.resolve();
        yield sourceBytes.subarray(0, 5);
        yield sourceBytes.subarray(5);
      })(),
      close: jest.fn(),
    } as const;
  }

  function withFixedSource(
    t: Awaited<ReturnType<typeof anchorSetup>>,
    reader: ItemFixedSourceReader,
    now = () => new Date(observedAt),
  ) {
    return new ItemManifestObserver(t.f.store, t.keyFromUrl, { reader, now });
  }

  async function profileSetup(
    change: Partial<ItemSourceProfileRecord> = {},
    now = () => new Date(observedAt),
  ) {
    const t = await anchorSetup();
    const objectRead = fixedRead(t);
    const definition = {
      protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1',
      id: t.f.id(71),
      revision: 3,
      issuerId: t.f.id(72),
      selectorHash: archiveHash({
        bucket: t.intent.bucket,
        key: t.intent.source.key,
        versionId: t.intent.source.revision.versionId,
        expectedBucketOwner: retention.expectedBucketOwner,
      }),
      signerContextHash: 'c'.repeat(64),
      controlsHash: 'd'.repeat(64),
      validFrom: '2026-11-07T14:00:00.000Z',
      validUntil: '2026-11-07T16:00:00.000Z',
      ...change,
    } as const;
    const profile = {
      ...definition,
      definitionHash: archiveHash(definition),
      state: 'ACTIVE',
    } as const satisfies ItemSourceProfileRecord;
    const readCurrentSourceProfile = jest.fn().mockResolvedValue(profile);
    const storage = {
      encryption: 'SSE_S3',
      storageClass: 'OMITTED',
      restoreOrArchiveReported: false,
    } as const;
    const readFixedSource = jest
      .fn()
      .mockResolvedValue({ ...objectRead, storage });
    const observer = new ItemManifestObserver(t.f.store, t.keyFromUrl, {
      reader: { readFixedSource },
      now,
      profiles: { readCurrentSourceProfile },
    });
    const { id, revision, definitionHash } = profile;
    return {
      ...t,
      observer,
      profile,
      objectRead,
      storage,
      readFixedSource,
      readCurrentSourceProfile,
      profileInput: {
        anchor: t.anchorInput,
        expectedProfile: { id, revision, definitionHash },
      },
    };
  }

  describe('isolated source artifact', () => {
    it('composes the bounded memory custodian and rejects instance loss under the same reservation', async () => {
      const t = await profileSetup();
      const limits = {
        maxArtifactBytes: sourceBytes.length,
        maxTotalBytes: sourceBytes.length,
        maxArtifacts: 1,
        maxOpenReaders: 1,
      };
      const custody = new InMemoryItemSourceArtifactCustody(limits);
      const draft = custody.createDraft(t.intent.source.revision.size);
      const seal = await t.observer.sealHistoricalSourceArtifact(
        t.profileInput,
        draft,
      );
      const handle = await t.observer.openHistoricalSourceArtifact(
        t.profileInput,
        seal,
        custody,
      );
      const bytes: Uint8Array[] = [];
      for await (const chunk of handle.body) bytes.push(chunk);
      expect(Buffer.concat(bytes)).toEqual(sourceBytes);
      await expect(
        t.observer.openHistoricalSourceArtifact(
          t.profileInput,
          seal,
          new InMemoryItemSourceArtifactCustody(limits),
        ),
      ).rejects.toThrow('artifact is unavailable');
      expect(draft.releaseSealed(seal.artifactHash)).toBe(true);
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    });

    function custody(t: Awaited<ReturnType<typeof profileSetup>>) {
      const identity = { id: 'isolated-file', generation: 'generation-1' };
      const pending: Uint8Array[] = [];
      let artifact:
        | { receipt: ItemSourceArtifactSeal; bytes: Buffer }
        | undefined;
      const outsideTransaction = () =>
        expect(t.f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
      const draft = {
        identity,
        write: jest.fn((bytes: Uint8Array) => {
          outsideTransaction();
          pending.push(bytes);
          return Promise.resolve();
        }),
        seal: jest.fn((receipt: ItemSourceArtifactSeal) => {
          outsideTransaction();
          expect(t.objectRead.close).toHaveBeenCalledTimes(1);
          artifact = { receipt, bytes: Buffer.concat(pending) };
          return Promise.resolve();
        }),
        discard: jest.fn().mockResolvedValue(undefined),
      };
      const close = jest.fn();
      const open = jest.fn(
        (
          ref: ItemSourceArtifactIdentity,
        ): Promise<OpenItemSourceArtifact | null> => {
          outsideTransaction();
          if (
            !artifact ||
            ref.id !== artifact.receipt.id ||
            ref.generation !== artifact.receipt.generation
          )
            return Promise.resolve(null);
          const { receipt, bytes } = artifact;
          const body = (async function* () {
            yield await Promise.resolve(Buffer.from(bytes));
          })();
          return Promise.resolve({ seal: receipt, body, close });
        },
      );
      return {
        draft,
        open,
        close,
        seal: () =>
          t.observer.sealHistoricalSourceArtifact(t.profileInput, draft),
        read: (seal: ItemSourceArtifactSeal) =>
          t.observer.openHistoricalSourceArtifact(t.profileInput, seal, {
            open,
          }),
      };
    }

    it('seals detached verified bytes and opens the exact generation without another GET', async () => {
      const t = await profileSetup();
      const original = Buffer.from(sourceBytes);
      t.readFixedSource.mockResolvedValue({
        ...t.objectRead,
        storage: t.storage,
        body: (async function* () {
          yield await Promise.resolve(original.subarray(0, 5));
          original.fill(0, 0, 5);
          yield original.subarray(5);
        })(),
      });
      const c = custody(t);
      const before = structuredClone(t.f.state.db);
      const seal = await c.seal();
      expect(seal).toMatchObject({
        ...c.draft.identity,
        selectorHash: t.profile.selectorHash,
        profileDefinitionHash: t.profile.definitionHash,
        sha256: t.intent.source.sha256,
        size: sourceBytes.length,
        reservation: 'OBSERVED_ONLY',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      const { artifactHash, ...definition } = seal;
      expect(artifactHash).toBe(archiveHash(definition));
      expect(Object.isFrozen(seal)).toBe(true);
      expect(c.draft.write).toHaveBeenCalledTimes(2);
      expect(c.draft.seal).toHaveBeenCalledWith(seal);
      expect(c.draft.discard).not.toHaveBeenCalled();
      original.fill(0);
      const opened = await c.read(seal);
      expect(c.open).toHaveBeenCalledWith(c.draft.identity);
      expect(opened.seal).toEqual(seal);
      const bytes: Uint8Array[] = [];
      for await (const chunk of opened.body) bytes.push(chunk);
      opened.close();
      expect(Buffer.concat(bytes)).toEqual(sourceBytes);
      expect(c.close).toHaveBeenCalledTimes(1);
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(0);
    });

    it.each([
      'short body',
      'different digest',
      'custody write failure',
      'reservation change',
    ] as const)('discards only the unsealed draft on %s', async (reason) => {
      const t = await profileSetup();
      const c = custody(t);
      if (reason === 'short body' || reason === 'different digest') {
        t.readFixedSource.mockResolvedValue({
          ...t.objectRead,
          storage: t.storage,
          body: (async function* () {
            yield await Promise.resolve(
              Buffer.alloc(reason === 'short body' ? 1 : sourceBytes.length),
            );
          })(),
        });
      }
      if (reason === 'custody write failure')
        c.draft.write.mockRejectedValueOnce(new Error('write failed'));
      if (reason === 'reservation change')
        c.draft.write.mockImplementationOnce(() => {
          t.f.state.db.controls[0].reservationEpoch = 3;
          return Promise.resolve();
        });
      await expect(c.seal()).rejects.toThrow();
      expect(t.objectRead.close).toHaveBeenCalledTimes(1);
      expect(c.draft.seal).not.toHaveBeenCalled();
      expect(c.draft.discard).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    });

    it.each([
      'seal response lost',
      'reservation changed while sealing',
    ] as const)(
      'preserves custody after seal starts when %s',
      async (reason) => {
        const t = await profileSetup();
        const c = custody(t);
        if (reason === 'seal response lost') {
          const seal = c.draft.seal.getMockImplementation()!;
          c.draft.seal.mockImplementationOnce(async (receipt) => {
            await seal(receipt);
            throw new Error('seal response lost');
          });
        } else {
          c.draft.seal.mockImplementationOnce(() => {
            t.f.state.db.controls[0].reservationEpoch = 3;
            return Promise.resolve();
          });
        }
        await expect(c.seal()).rejects.toThrow();
        expect(c.draft.seal).toHaveBeenCalledTimes(1);
        expect(c.draft.discard).not.toHaveBeenCalled();
        expect(t.f.state.writes).toBe(0);
      },
    );

    it.each([
      'corrupt seal',
      'different profile',
      'different reservation',
    ] as const)('rejects %s before opening custody', async (reason) => {
      const t = await profileSetup();
      const c = custody(t);
      const seal = await c.seal();
      if (reason === 'different profile')
        t.profileInput.expectedProfile.definitionHash = '0'.repeat(64);
      if (reason === 'different reservation')
        t.f.state.db.controls[0].reservationEpoch = 3;
      await expect(
        c.read(
          reason === 'corrupt seal' ? { ...seal, size: seal.size + 1 } : seal,
        ),
      ).rejects.toThrow();
      expect(c.open).not.toHaveBeenCalled();
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    });

    it('rejects a missing generation without reopening the origin', async () => {
      const t = await profileSetup();
      const c = custody(t);
      const seal = await c.seal();
      c.open.mockResolvedValueOnce(null);
      await expect(c.read(seal)).rejects.toThrow('artifact is unavailable');
      expect(c.open).toHaveBeenCalledTimes(1);
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(c.draft.discard).not.toHaveBeenCalled();
      expect(t.f.state.writes).toBe(0);
    });

    it.each([
      'substituted generation',
      'reservation changed',
      'reservation changed during profile reread',
      'profile invalidated',
    ] as const)('closes the opened handle on %s', async (reason) => {
      const t = await profileSetup();
      const c = custody(t);
      const seal = await c.seal();
      const open = c.open.getMockImplementation()!;
      c.open.mockImplementationOnce(async (identity) => {
        const handle = (await open(identity))!;
        if (reason === 'substituted generation')
          return {
            ...handle,
            seal: buildItemSourceArtifactSeal({
              ...seal,
              generation: 'generation-2',
            }),
          };
        if (reason === 'reservation changed')
          t.f.state.db.controls[0].reservationEpoch = 3;
        if (reason === 'reservation changed during profile reread')
          t.readCurrentSourceProfile.mockImplementationOnce(() => {
            t.f.state.db.controls[0].reservationEpoch = 3;
            return Promise.resolve(t.profile);
          });
        if (reason === 'profile invalidated')
          t.readCurrentSourceProfile.mockResolvedValue({
            ...t.profile,
            state: 'INVALIDATED',
          });
        return handle;
      });
      await expect(c.read(seal)).rejects.toThrow();
      expect(c.close).toHaveBeenCalledTimes(1);
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    });
  });

  it('links the exact revision and both unchanged observations with one GET and no writes', async () => {
    const t = await profileSetup();
    const prior = await withFixedSource(t, {
      readFixedSource: jest
        .fn()
        .mockResolvedValue({ ...fixedRead(t), storage: t.storage }),
    }).observeHistoricalSourceStorage(t.anchorInput);
    t.readSource.mockClear();
    const before = structuredClone(t.f.state.db);
    t.readFixedSource.mockImplementationOnce(() => {
      expect(t.readCurrentSourceProfile).toHaveBeenCalledTimes(1);
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
      return Promise.resolve({ ...t.objectRead, storage: t.storage });
    });
    t.readCurrentSourceProfile.mockImplementationOnce(() =>
      Promise.resolve(t.profile),
    );
    t.readCurrentSourceProfile.mockImplementationOnce(() => {
      expect(t.objectRead.close).toHaveBeenCalledTimes(1);
      expect(t.readSource).toHaveBeenCalledTimes(1);
      return Promise.resolve(t.profile);
    });
    const result = await t.observer.observeHistoricalSourceProfile(
      t.profileInput,
    );
    const { observationHash, ...definition } = result.profileObservation;
    expect(result.fixedSource).toEqual(prior.fixedSource);
    expect(result.storageObservation).toEqual(prior.storageObservation);
    expect(result.storageObservation.classification).toBe(
      'STANDARD_IF_DIRECT_S3',
    );
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_OBSERVATION_V1',
      profile: t.profileInput.expectedProfile,
      fixedSourceObservationHash: prior.fixedSource.observationHash,
      storageObservationHash: prior.storageObservation.observationHash,
      reservation: 'OBSERVED_ONLY',
      readability: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(observationHash).toBe(archiveHash(definition));
    expect(Object.isFrozen(result.profileObservation.profile)).toBe(true);
    expect(t.readCurrentSourceProfile.mock.calls).toEqual([
      [t.profile.id],
      [t.profile.id],
    ]);
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
  });

  async function profileSetSetup() {
    const t = await profileSetup();
    const observed = await t.observer.observeHistoricalSourceProfile(
      t.profileInput,
    );
    const material = await t.f.store.readHistoricalSourceForAnchor(
      t.anchorInput,
    );
    const match = (
      raw: ItemSourceProfileObservationSet,
      anchor = material,
      owner: string = retention.expectedBucketOwner,
      ref = t.profileInput.expectedProfile,
    ) => matchItemSourceProfileObservationSet(raw, anchor, owner, ref);
    return { ...t, observed, material, match };
  }

  it('reconstructs and freezes the complete observation set for historical reread', async () => {
    const t = await profileSetSetup();
    const raw = structuredClone(t.observed);
    const saved = t.match(raw);
    expect(saved).toEqual(raw);
    expect(saved).not.toBe(raw);
    for (const value of [
      saved,
      ...Object.values(saved),
      saved.profileObservation.profile,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(saved.storageObservation.classification).toBe(
      'STANDARD_IF_DIRECT_S3',
    );
    expect(saved.profileObservation).toMatchObject({
      reservation: 'OBSERVED_ONLY',
      readability: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.readCurrentSourceProfile).toHaveBeenCalledTimes(2);
  });

  it('rejects the complete set under a different manifest, bucket owner or profile revision', async () => {
    const t = await profileSetSetup();
    expect(() =>
      t.match(t.observed, { ...t.material, manifestHash: '0'.repeat(64) }),
    ).toThrow();
    expect(() => t.match(t.observed, t.material, '000000000001')).toThrow();
    expect(() =>
      t.match(t.observed, t.material, retention.expectedBucketOwner, {
        ...t.profileInput.expectedProfile,
        revision: t.profile.revision + 1,
      }),
    ).toThrow();
  });

  it.each([
    ['fixedSource', { observationHash: '0'.repeat(64) }],
    ['fixedSource', { eventHold: 'ON' }],
    ['fixedSource', { copyDispatch: 'AUTHORIZED' }],
    ['storageObservation', { fixedSourceObservationHash: '0'.repeat(64) }],
    ['storageObservation', { classification: 'MATCHES_CANDIDATE_METADATA' }],
    ['profileObservation', { storageObservationHash: '0'.repeat(64) }],
    ['profileObservation', { readability: 'PROVEN' }],
    ['profileObservation', { unknown: undefined }],
  ] as const)(
    'rejects invalid persisted fields in %s (%j)',
    async (part, change) => {
      const t = await profileSetSetup();
      const mixed = {
        ...t.observed,
        [part]: { ...t.observed[part], ...change },
      };
      expect(() => t.match(mixed)).toThrow();
    },
  );

  it('rejects partial observations and unexpected envelope fields', async () => {
    const t = await profileSetSetup();
    const raw = { ...t.observed, report: undefined };
    expect(() => t.match(raw)).toThrow();
    for (const part of Object.keys(t.observed))
      expect(() => t.match({ ...t.observed, [part]: null })).toThrow();
    const profileObservation = {
      ...t.observed.profileObservation,
      profile: { ...t.observed.profileObservation.profile, extra: undefined },
    };
    expect(() => t.match({ ...t.observed, profileObservation })).toThrow();
  });

  it('rejects a coherently hashed set if its selector differs from the pinned source', async () => {
    const t = await profileSetSetup();
    const fixedSource = buildItemFixedSourceObservation({
      ...t.observed.fixedSource,
      selectorHash: '0'.repeat(64),
    });
    const storageObservation = buildItemSourceStorageObservation(
      fixedSource.observationHash,
      t.observed.storageObservation,
    );
    const profileObservation = buildItemSourceProfileObservation(
      t.profileInput.expectedProfile,
      fixedSource,
      storageObservation,
    );
    expect(() =>
      t.match({ fixedSource, storageObservation, profileObservation }),
    ).toThrow('observation set is inconsistent');
  });

  async function profilePersistenceSetup() {
    const t = await profileSetup();
    const state = {
      profile: t.profile as ItemSourceProfileRecord,
      checkedAt: observedAt,
    };
    type Fence = MongoItemSourceProfileState['fenceActiveSourceProfile'];
    const fenceActiveSourceProfile = jest.fn<
      ReturnType<Fence>,
      Parameters<Fence>
    >((expected, _session, validate) => {
      expect(expected).toEqual(t.profileInput.expectedProfile);
      if (state.profile.state !== 'ACTIVE')
        return Promise.reject(new ConflictError('Profile invalidated'));
      validate?.(state.profile);
      return Promise.resolve();
    });
    const { models } = t.f;
    type Read = MongoItemSourceProfileState['readActiveSourceAccreditation'];
    const accreditation = {
      profileDefinitionHash: t.profile.definitionHash,
      endpoint: 'DIRECT_S3',
      evidenceHash: 'f'.repeat(64),
      validFrom: t.profile.validFrom,
      validUntil: t.profile.validUntil,
    } as const;
    const readActiveSourceAccreditation = jest.fn<
      ReturnType<Read>,
      Parameters<Read>
    >(() => Promise.resolve({ profile: state.profile, accreditation }));
    const boundFor = jest.fn<ItemSourceLastReadBound | null, [string, string]>(
      (attemptDefinitionHash, signerContextHash) => ({
        basis: 'ACCREDITED_LAST_SOURCE_READ',
        attemptDefinitionHash,
        signerContextHash,
        evidenceHash: 'e'.repeat(64),
        lastReadAt: '2026-11-07T15:30:00.000Z',
        marginMs: 60_000,
      }),
    );
    const store = new MongoTransferItemCapture(
      ...([
        models[0],
        models[1],
        models[2],
        models[9],
        models[4],
        models[5],
        models[12],
        models[13],
        models[14],
        {
          profiles: { fenceActiveSourceProfile, readActiveSourceAccreditation },
          now: () => new Date(state.checkedAt),
          assessment: {
            expectedBucketOwner: retention.expectedBucketOwner,
            boundFor,
          },
        },
      ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
    );
    const pins = {
      ...t.profileInput,
      expectedBucketOwner: retention.expectedBucketOwner,
    };
    const preparer = new ItemManifestPreparer(
      store,
      t.observer,
      pins.expectedBucketOwner,
    );
    return {
      ...t,
      state,
      store,
      pins,
      preparer,
      fenceActiveSourceProfile,
      readActiveSourceAccreditation,
      boundFor,
    };
  }

  async function sourceWindowSetup() {
    const t = await profilePersistenceSetup();
    const { observation } = await t.preparer.prepareHistoricalSourceProfile(
      t.profileInput,
    );
    const preparation = t.anchorInput.preparation;
    const gate = await t.store.openCopyGate(preparation.selector);
    const attempt = await t.store.declareCopyAttempt({
      preparation,
      attemptId: t.f.id(85),
      dispatcherInstanceId: t.f.id(86),
      kind: 'HISTORICAL',
      origin: 'INITIAL',
      expectedGateRevision: gate.gateRevision,
    });
    const input = {
      ...t.profileInput,
      attemptId: attempt.attemptId!,
      expectedAttemptDefinitionHash: attempt.attemptDefinitionHash!,
      expectedGateRevision: attempt.gateRevision,
    };
    t.f.state.writes = 0;
    t.f.calls.length = 0;
    t.fenceActiveSourceProfile.mockClear();
    return { ...t, observation, assessmentInput: input };
  }

  it('assesses the persisted attempt, gate, reservation, observation and accreditation in one read-only snapshot', async () => {
    const t = await sourceWindowSetup();
    const before = structuredClone(t.f.state.db);
    const result = await t.store.assessSourceReadWindow(t.assessmentInput);
    expect(result).toMatchObject({
      assessment: 'WINDOW_FITS',
      attemptDefinitionHash: t.assessmentInput.expectedAttemptDefinitionHash,
      profileObservationHash: t.observation.profileObservation.observationHash,
      reservation: 'OBSERVED_ONLY',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(
      t.f.calls.filter((call) => call.role === 'copyRecords'),
    ).toHaveLength(2);
    const session = t.f.sessions.at(-1);
    expect(t.f.calls.every((call) => call.session === session)).toBe(true);
    expect(t.readActiveSourceAccreditation).toHaveBeenCalledTimes(1);
    expect(t.readActiveSourceAccreditation.mock.calls[0][0]).toEqual(
      t.pins.expectedProfile,
    );
    expect(t.readActiveSourceAccreditation.mock.calls[0][1]).toBe(session);
    expect(t.boundFor.mock.calls).toEqual([
      [
        t.assessmentInput.expectedAttemptDefinitionHash,
        t.profile.signerContextHash,
      ],
    ]);
    expect(t.fenceActiveSourceProfile).not.toHaveBeenCalled();
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
  });

  async function recordedWindowSetup(kind?: 'missing' | 'signer') {
    const t = await sourceWindowSetup();
    const row = () =>
      t.f.state.db.copyRecords.find(
        (record) => record.id === t.assessmentInput.attemptId,
      )!;
    const { definition } = row() as unknown as ItemCopyAttemptRecord;
    const signerContextHash =
      kind === 'signer' ? '0'.repeat(64) : t.profile.signerContextHash;
    const bound = buildItemSourceDelegationBound(
      {
        basis: 'ACCREDITED_LAST_SOURCE_READ',
        attemptDefinitionHash: definition.definitionHash,
        signerContextHash,
        evidenceHash: 'a'.repeat(64),
        delegateBefore: '2026-11-07T15:20:00.000Z',
        lastReadAt: '2026-11-07T15:30:00.000Z',
        marginMs: 60_000,
      },
      definition,
      signerContextHash,
    );
    const receipt =
      kind === 'missing'
        ? undefined
        : await t.store.recordSourceDelegationBound(
            {
              preparation: t.anchorInput.preparation,
              attemptId: definition.id,
              expectedAttemptDefinitionHash: definition.definitionHash,
              expectedGateRevision: t.assessmentInput.expectedGateRevision,
              signerContextHash,
            },
            bound,
          );
    t.f.state.writes = 0;
    t.f.calls.length = 0;
    t.boundFor.mockImplementation(() => {
      throw new Error('Unexpected observational bound lookup');
    });
    return {
      ...t,
      row,
      bound,
      recordedInput: {
        ...t.assessmentInput,
        expectedGateRevision:
          receipt?.gateRevision ?? t.assessmentInput.expectedGateRevision,
        expectedBoundHash: bound.boundHash,
      },
    };
  }

  it('assesses the exact recorded bound and accredited signer in the caller snapshot one millisecond before the deadline', async () => {
    const t = await recordedWindowSetup();
    t.state.checkedAt = '2026-11-07T15:19:59.999Z';
    const before = structuredClone(t.f.state.db);
    const { assessmentHash, ...result } = await t.store.assessSourceReadWindow(
      t.recordedInput,
    );
    expect(result).toMatchObject({
      protocol: 'ITEM_HISTORICAL_RECORDED_SOURCE_READ_WINDOW_V1',
      boundHash: t.bound.boundHash,
      delegateBefore: t.bound.delegateBefore,
      readBoundEvidenceHash: t.bound.evidenceHash,
      attemptDefinitionHash: t.recordedInput.expectedAttemptDefinitionHash,
      assessment: 'WINDOW_FITS',
      reservation: 'OBSERVED_ONLY',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(assessmentHash).toBe(archiveHash(result));
    const session = t.f.sessions.at(-1);
    expect(t.f.calls.every((call) => call.session === session)).toBe(true);
    expect(t.readActiveSourceAccreditation.mock.calls[0][1]).toBe(session);
    expect(t.boundFor).not.toHaveBeenCalled();
    expect(t.fenceActiveSourceProfile).not.toHaveBeenCalled();
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
  });

  it.each([
    'missing',
    'signer',
    'hash',
    'corrupt',
    'deadline',
    'after deadline',
    'invalid hash',
    'accreditation',
  ] as const)(
    'rejects a recorded assessment with %s without falling back or writing',
    async (kind) => {
      const t = await recordedWindowSetup(
        kind === 'missing' || kind === 'signer' ? kind : undefined,
      );
      const input = { ...t.recordedInput };
      if (kind === 'hash') input.expectedBoundHash = '0'.repeat(64);
      if (kind === 'invalid hash') input.expectedBoundHash = '';
      if (kind === 'corrupt')
        t.row().delegationBound = { ...t.bound, marginMs: 1 };
      if (kind === 'deadline') t.state.checkedAt = t.bound.delegateBefore;
      if (kind === 'after deadline')
        t.state.checkedAt = '2026-11-07T15:20:00.001Z';
      if (kind === 'accreditation')
        t.readActiveSourceAccreditation.mockResolvedValueOnce(null);
      const before = structuredClone(t.f.state.db);
      const sessions = t.f.sessions.length;
      await expect(async () =>
        t.store.assessSourceReadWindow(input),
      ).rejects.toThrow();
      if (kind === 'invalid hash') expect(t.f.sessions).toHaveLength(sessions);
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(0);
      expect(t.boundFor).not.toHaveBeenCalled();
      expect(t.fenceActiveSourceProfile).not.toHaveBeenCalled();
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'gate revision',
    'revoked gate',
    'missing attempt',
    'attempt hash',
    'wrong attempt state',
    'missing set',
    'corrupt set',
    'lost reservation',
    'missing accreditation',
    'invalidated controls',
    'missing bound',
    'wrong bound',
    'expired window',
  ] as const)(
    'blocks the assessment with %s without writing or repeating the GET',
    async (kind) => {
      const t = await sourceWindowSetup();
      const input = { ...t.assessmentInput };
      if (kind === 'gate revision') input.expectedGateRevision--;
      if (kind === 'revoked gate') {
        const revoked = await t.store.revokeCopyGate({
          selector: input.anchor.preparation.selector,
          expectedGateRevision: input.expectedGateRevision,
          requestId: t.f.id(87),
          evidenceRef: 'test:revoked',
        });
        input.expectedGateRevision = revoked.gateRevision;
      }
      if (kind === 'missing attempt')
        t.f.state.db.copyRecords = t.f.state.db.copyRecords.filter(
          (row) => row.id !== input.attemptId,
        );
      if (kind === 'attempt hash')
        input.expectedAttemptDefinitionHash = '0'.repeat(64);
      if (kind === 'wrong attempt state')
        t.f.state.db.copyRecords.find(
          (row) => row.id === input.attemptId,
        )!.state = 'AUTHORIZED';
      if (kind === 'missing set')
        delete t.currentFile().sourceProfileObservationSet;
      if (kind === 'corrupt set')
        t.currentFile().sourceProfileObservationSet = {
          fixedSource: t.observation.fixedSource,
        };
      if (kind === 'lost reservation')
        t.f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'missing accreditation')
        t.readActiveSourceAccreditation.mockResolvedValueOnce(null);
      if (kind === 'invalidated controls')
        t.readActiveSourceAccreditation.mockRejectedValueOnce(
          new ConflictError('Controls invalidated'),
        );
      if (kind === 'missing bound') t.boundFor.mockReturnValueOnce(null);
      if (kind === 'wrong bound')
        t.boundFor.mockImplementationOnce((_, signerContextHash) => ({
          basis: 'ACCREDITED_LAST_SOURCE_READ',
          attemptDefinitionHash: '0'.repeat(64),
          signerContextHash,
          evidenceHash: 'e'.repeat(64),
          lastReadAt: '2026-11-07T15:30:00.000Z',
          marginMs: 60_000,
        }));
      if (kind === 'expired window') t.state.checkedAt = t.profile.validUntil;
      const before = structuredClone(t.f.state.db);
      const writes = t.f.state.writes;
      await expect(t.store.assessSourceReadWindow(input)).rejects.toThrow();
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(writes);
      expect(t.fenceActiveSourceProfile).not.toHaveBeenCalled();
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    },
  );

  it('stores the complete set with the four reservation fences and the profile guard in the caller session', async () => {
    const t = await profilePersistenceSetup();
    const before = structuredClone(t.currentFile());
    t.readFixedSource.mockImplementationOnce(() => {
      expect(
        t.f.sessions.every(
          (session) => session.endSession.mock.calls.length === 1,
        ),
      ).toBe(true);
      expect(t.f.state.writes).toBe(0);
      return Promise.resolve({ ...t.objectRead, storage: t.storage });
    });
    const receipt = await t.preparer.prepareHistoricalSourceProfile(
      t.profileInput,
    );
    expect(receipt.replayed).toBe(false);
    expect(t.currentFile()).toEqual({
      ...before,
      sourceProfileObservationSet: receipt.observation,
    });
    expect(t.header().manifestDigest).toEqual(t.digest);
    expect(receipt.observation.profileObservation).toMatchObject({
      reservation: 'OBSERVED_ONLY',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const writes = t.f.calls.filter((call) => call.method === 'updateOne');
    expect(writes.map((call) => call.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
      'files',
    ]);
    const session = t.f.sessions.at(-1);
    expect(writes.every((call) => call.session === session)).toBe(true);
    expect(t.fenceActiveSourceProfile).toHaveBeenCalledTimes(1);
    expect(t.fenceActiveSourceProfile.mock.calls[0][1]).toBe(session);
    expect(writes[4].filter.sourceProfileObservationSet).toEqual({
      $exists: false,
    });

    t.state.profile = { ...t.profile, state: 'INVALIDATED' };
    t.state.checkedAt = '2028-01-01T00:00:00.000Z';
    const saved = structuredClone(t.f.state.db);
    const replay = { ...receipt, replayed: true };
    await expect(
      t.preparer.prepareHistoricalSourceProfile(t.profileInput),
    ).resolves.toEqual(replay);
    await expect(
      t.store.confirmSourceProfileObservation(t.pins, receipt.observation),
    ).resolves.toEqual(replay);
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.fenceActiveSourceProfile).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(5);
    expect(t.f.state.db).toEqual(saved);
  });

  it.each(['profile', 'selector', 'window', 'date', 'file CAS'] as const)(
    'rolls back reservation fences and keeps the file unchanged after %s failure',
    async (kind) => {
      const t = await profilePersistenceSetup();
      const observed = await t.observer.observeHistoricalSourceProfile(
        t.profileInput,
      );
      if (kind === 'profile')
        t.state.profile = { ...t.profile, state: 'INVALIDATED' };
      if (kind === 'selector')
        t.state.profile = { ...t.profile, selectorHash: '0'.repeat(64) };
      if (kind === 'window') t.state.checkedAt = t.profile.validUntil;
      if (kind === 'date')
        t.state.checkedAt = observed.fixedSource.fixedRetainUntil;
      if (kind === 'file CAS') t.f.state.noOp = 'files.updateOne';
      const before = structuredClone(t.f.state.db);
      await expect(
        t.store.confirmSourceProfileObservation(t.pins, observed),
      ).rejects.toThrow();
      expect(t.f.state.db).toEqual(before);
      expect(t.fenceActiveSourceProfile).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(kind === 'file CAS' ? 5 : 4);
    },
  );

  it('recovers an acknowledged commit after losing the application reply', async () => {
    const t = await profilePersistenceSetup();
    const observation = await t.observer.observeHistoricalSourceProfile(
      t.profileInput,
    );
    t.f.state.loseReply = true;
    await expect(
      t.store.confirmSourceProfileObservation(t.pins, observation),
    ).rejects.toThrow();
    expect(t.currentFile().sourceProfileObservationSet).toEqual(observation);
    await expect(
      t.preparer.prepareHistoricalSourceProfile(t.profileInput),
    ).resolves.toEqual({
      observation,
      replayed: true,
    });
    expect(t.readFixedSource).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(5);
  });

  it('preserves the first set when a different coherent confirmation arrives', async () => {
    const t = await profilePersistenceSetup();
    const { observation } = await t.preparer.prepareHistoricalSourceProfile(
      t.profileInput,
    );
    const fixedSource = buildItemFixedSourceObservation({
      ...observation.fixedSource,
      fixedRetainUntil: '2027-03-01T00:00:00.000Z',
    });
    const storageObservation = buildItemSourceStorageObservation(
      fixedSource.observationHash,
      observation.storageObservation,
    );
    const profileObservation = buildItemSourceProfileObservation(
      t.pins.expectedProfile,
      fixedSource,
      storageObservation,
    );
    const before = structuredClone(t.f.state.db);
    await expect(
      t.store.confirmSourceProfileObservation(t.pins, {
        fixedSource,
        storageObservation,
        profileObservation,
      }),
    ).rejects.toThrow('cannot be replaced');
    expect(t.f.state.db).toEqual(before);
    expect(t.fenceActiveSourceProfile).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(5);
  });

  it.each(['corrupt', 'different revision', 'lost reservation'] as const)(
    'rejects a %s stored set without repeating the GET or writing fences',
    async (kind) => {
      const t = await profilePersistenceSetup();
      const { observation } = await t.preparer.prepareHistoricalSourceProfile(
        t.profileInput,
      );
      const request = structuredClone(t.profileInput);
      if (kind === 'corrupt')
        t.currentFile().sourceProfileObservationSet = {
          fixedSource: observation.fixedSource,
        };
      if (kind === 'different revision') request.expectedProfile.revision++;
      if (kind === 'lost reservation')
        t.f.state.db.controls[0].reservationEpoch = 3;
      const before = structuredClone(t.f.state.db);
      await expect(
        t.preparer.prepareHistoricalSourceProfile(request),
      ).rejects.toThrow();
      expect(t.f.state.db).toEqual(before);
      expect(t.readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.fenceActiveSourceProfile).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(5);
    },
  );

  it('refuses first installation when the profile guard was not composed', async () => {
    const t = await profilePersistenceSetup();
    const observation = await t.observer.observeHistoricalSourceProfile(
      t.profileInput,
    );
    const before = structuredClone(t.f.state.db);
    await expect(
      t.f.store.confirmSourceProfileObservation(t.pins, observation),
    ).rejects.toThrow();
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
  });

  it('refuses to reinstall missing predecessors around an orphan profile set', async () => {
    const t = await profilePersistenceSetup();
    t.currentFile().sourceProfileObservationSet = null;
    delete t.currentFile().sourceByteObservation;
    await expect(
      t.store.confirmSourceObservation(t.anchorInput.preparation, t.source),
    ).rejects.toThrow();
    delete t.currentFile().historicalCopyIntent;
    await expect(
      t.store.prepareHistoricalCopy(t.anchorInput.preparation),
    ).rejects.toThrow();
    expect(t.currentFile().historicalCopyIntent).toBeUndefined();
    expect(t.currentFile().sourceByteObservation).toBeUndefined();
    expect(t.currentFile().sourceProfileObservationSet).toBeNull();
  });

  it.each([
    'missing',
    'invalidated',
    'other revision',
    'other ID',
    'tampered controls',
  ] as const)(
    'rejects a %s current profile before starting the GET',
    async (kind) => {
      const t = await profileSetup();
      const current = {
        ...t.profile,
        state: kind === 'invalidated' ? 'INVALIDATED' : t.profile.state,
        revision:
          kind === 'other revision'
            ? t.profile.revision + 1
            : t.profile.revision,
        id: kind === 'other ID' ? t.f.id(73) : t.profile.id,
        controlsHash:
          kind === 'tampered controls'
            ? 'e'.repeat(64)
            : t.profile.controlsHash,
      };
      t.readCurrentSourceProfile.mockResolvedValue(
        kind === 'missing' ? null : current,
      );
      await expect(
        t.observer.observeHistoricalSourceProfile(t.profileInput),
      ).rejects.toThrow('profile is unavailable, changed or invalid');
      expect(t.readCurrentSourceProfile).toHaveBeenCalledTimes(1);
      expect(t.readFixedSource).not.toHaveBeenCalled();
      expect(t.readSource).not.toHaveBeenCalled();
      expect(t.f.state.writes).toBe(0);
    },
  );

  it.each(['invalidated', 'advanced revision'] as const)(
    'rejects the linked observation if the profile was %s during streaming',
    async (kind) => {
      const t = await profileSetup();
      t.readFixedSource.mockResolvedValue({
        ...t.objectRead,
        storage: t.storage,
        body: (async function* () {
          yield sourceBytes.subarray(0, 5);
          await Promise.resolve();
          t.readCurrentSourceProfile.mockResolvedValue(
            kind === 'invalidated'
              ? { ...t.profile, state: 'INVALIDATED' }
              : { ...t.profile, revision: t.profile.revision + 1 },
          );
          yield sourceBytes.subarray(5);
        })(),
      });
      await expect(
        t.observer.observeHistoricalSourceProfile(t.profileInput),
      ).rejects.toThrow('profile is unavailable, changed or invalid');
      expect(t.readCurrentSourceProfile).toHaveBeenCalledTimes(2);
      expect(t.objectRead.close).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    },
  );

  it('rejects reservation loss during the second profile read', async () => {
    const t = await profileSetup();
    t.readCurrentSourceProfile
      .mockResolvedValueOnce(t.profile)
      .mockImplementationOnce(() => {
        t.f.state.db.controls[0].reservationEpoch = 3;
        return Promise.resolve(t.profile);
      });
    await expect(
      t.observer.observeHistoricalSourceProfile(t.profileInput),
    ).rejects.toThrow();
    expect(t.readCurrentSourceProfile).toHaveBeenCalledTimes(2);
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.objectRead.close).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });

  it('rejects a profile for another selector even with matching bytes', async () => {
    const t = await profileSetup({ selectorHash: 'f'.repeat(64) });
    await expect(
      t.observer.observeHistoricalSourceProfile(t.profileInput),
    ).rejects.toThrow('does not cover the original version');
    expect(t.objectRead.close).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });

  it('rejects storage outside the profile candidate', async () => {
    const t = await profileSetup();
    t.readFixedSource.mockResolvedValue({
      ...t.objectRead,
      storage: { ...t.storage, encryption: 'SSE_KMS' },
    });
    await expect(
      t.observer.observeHistoricalSourceProfile(t.profileInput),
    ).rejects.toThrow('outside the storage profile candidate');
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.objectRead.close).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });

  it.each(['before GET', 'during GET', 'at local revalidation'] as const)(
    'rejects a profile that expires %s',
    async (point) => {
      const beforeExpiry = new Date(observedAt);
      const expiry = new Date('2026-11-07T16:00:00.000Z');
      const now = jest
        .fn()
        .mockReturnValueOnce(point === 'before GET' ? expiry : beforeExpiry)
        .mockReturnValueOnce(point === 'during GET' ? expiry : beforeExpiry)
        .mockReturnValue(expiry);
      const t = await profileSetup({}, now);
      await expect(
        t.observer.observeHistoricalSourceProfile(t.profileInput),
      ).rejects.toThrow('outside its observation window');
      expect(t.readFixedSource).toHaveBeenCalledTimes(
        point === 'before GET' ? 0 : 1,
      );
      expect(t.objectRead.close).toHaveBeenCalledTimes(
        point === 'before GET' ? 0 : 1,
      );
      expect(t.f.state.writes).toBe(0);
    },
  );

  it('rejects caller-supplied profile facts and freezes the selected revision before the first await', async () => {
    const t = await profileSetup();
    await expect(
      t.observer.observeHistoricalSourceProfile({
        ...t.profileInput,
        expectedProfile: t.profile,
      }),
    ).rejects.toThrow('profile is unavailable, changed or invalid');
    expect(t.readCurrentSourceProfile).not.toHaveBeenCalled();
    const mutable = structuredClone(t.profileInput);
    const pending = t.observer.observeHistoricalSourceProfile(mutable);
    mutable.expectedProfile.revision++;
    mutable.anchor.preparation.selector.itemId = t.f.id(75);
    expect((await pending).profileObservation.profile).toEqual(
      t.profileInput.expectedProfile,
    );
    expect(t.readCurrentSourceProfile.mock.calls).toEqual([
      [t.profile.id],
      [t.profile.id],
    ]);
  });

  it('observes the exact source bytes and fixed date then revalidates the original anchor without writes', async () => {
    const t = await anchorSetup();
    const anchor = await t.observer.anchorHistoricalSource(t.anchorInput);
    t.readSource.mockClear();
    const before = structuredClone(t.f.state.db);
    const read = fixedRead(t);
    const readFixedSource = jest.fn(() => {
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
      return Promise.resolve(read);
    });
    const observation = await withFixedSource(t, {
      readFixedSource,
    }).observeHistoricalFixedSource(t.anchorInput);
    expect(readFixedSource).toHaveBeenCalledTimes(1);
    expect(readFixedSource).toHaveBeenCalledWith(
      { bucket: t.intent.bucket, key: t.intent.source.key },
      t.intent.source.revision,
    );
    const { observationHash, ...definition } = observation;
    expect(observationHash).toBe(archiveHash(definition));
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_FIXED_SOURCE_OBSERVATION_V1',
      anchorHash: anchor.anchorHash,
      selectorHash: archiveHash({
        bucket: t.intent.bucket,
        key: t.intent.source.key,
        versionId: t.intent.source.revision.versionId,
        expectedBucketOwner: retention.expectedBucketOwner,
      }),
      mode: 'COMPLIANCE',
      eventHold: 'OFF',
      observedAt,
      fixedRetainUntil: retention.reportedRetainUntil,
      bytes: 'MATCH',
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      readability: 'NOT_ASSESSED',
      coverage: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(read.close).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
  });

  it.each([
    ['SSE_S3', 'STANDARD', false, 'MATCHES_CANDIDATE_METADATA'],
    ['SSE_S3', 'OMITTED', false, 'STANDARD_IF_DIRECT_S3'],
    ['SSE_S3', 'OTHER', false, 'OUTSIDE_CANDIDATE'],
    ['SSE_S3', 'STANDARD', true, 'OUTSIDE_CANDIDATE'],
    ['SSE_KMS', 'STANDARD', false, 'OUTSIDE_CANDIDATE'],
    ['SSE_C', 'STANDARD', false, 'OUTSIDE_CANDIDATE'],
    ['UNKNOWN', 'OMITTED', false, 'OUTSIDE_CANDIDATE'],
  ] as const)(
    'binds the storage classification for %s, %s and restore=%s to an unchanged fixed observation',
    async (
      encryption,
      storageClass,
      restoreOrArchiveReported,
      classification,
    ) => {
      const t = await anchorSetup();
      const baseline = await withFixedSource(t, {
        readFixedSource: jest.fn().mockResolvedValue(fixedRead(t)),
      }).observeHistoricalFixedSource(t.anchorInput);
      t.readSource.mockClear();
      const before = structuredClone(t.f.state.db);
      const read = fixedRead(t);
      const storage = { encryption, storageClass, restoreOrArchiveReported };
      const readFixedSource = jest.fn().mockResolvedValue({ ...read, storage });
      const result = await withFixedSource(t, {
        readFixedSource,
      }).observeHistoricalSourceStorage(t.anchorInput);
      const { observationHash, ...definition } = result.storageObservation;
      expect(result.fixedSource).toEqual(baseline);
      expect(definition).toEqual({
        protocol: 'ITEM_HISTORICAL_SOURCE_STORAGE_OBSERVATION_V1',
        fixedSourceObservationHash: baseline.observationHash,
        ...storage,
        classification,
        reservation: 'OBSERVED_ONLY',
        readability: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(observationHash).toBe(archiveHash(definition));
      expect(Object.isFrozen(result.storageObservation)).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(readFixedSource).toHaveBeenCalledTimes(1);
      expect(t.readSource).toHaveBeenCalledTimes(2);
      expect(read.close).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
      expect(t.f.state.db).toEqual(before);
    },
  );

  it('requires storage facts from the reader and preserves the fixed-only path', async () => {
    const t = await anchorSetup();
    const read = fixedRead(t);
    await expect(
      withFixedSource(t, {
        readFixedSource: jest.fn().mockResolvedValue(read),
      }).observeHistoricalSourceStorage(t.anchorInput),
    ).rejects.toThrow('storage metadata was not captured');
    await expect(
      withFixedSource(t, {
        readFixedSource: jest.fn().mockResolvedValue(fixedRead(t)),
      }).observeHistoricalFixedSource(t.anchorInput),
    ).resolves.toHaveProperty('bytes', 'MATCH');
    expect(read.close).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });

  it('snapshots storage facts before consuming the stream and revalidates the original reserve', async () => {
    const t = await anchorSetup();
    const read = fixedRead(t);
    const storage = {
      encryption: 'SSE_S3',
      storageClass: 'OMITTED',
      restoreOrArchiveReported: false,
    };
    const readFixedSource = jest.fn().mockResolvedValue({
      ...read,
      storage,
      body: (async function* () {
        yield sourceBytes.subarray(0, 5);
        await Promise.resolve();
        storage.storageClass = 'OTHER';
        yield sourceBytes.subarray(5);
      })(),
    });
    const result = await withFixedSource(t, {
      readFixedSource,
    }).observeHistoricalSourceStorage(t.anchorInput);
    expect(storage.storageClass).toBe('OTHER');
    expect(result.storageObservation).toMatchObject({
      storageClass: 'OMITTED',
      classification: 'STANDARD_IF_DIRECT_S3',
    });
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.f.state.writes).toBe(0);
  });

  it.each([
    'revision',
    'short',
    'oversize',
    'digest',
    'stream failure',
  ] as const)(
    'discards a fixed source observation on %s and closes the body',
    async (kind) => {
      const t = await anchorSetup();
      const read = fixedRead(t);
      const body = (async function* () {
        await Promise.resolve();
        if (kind === 'stream failure') throw new Error('private provider data');
        if (kind === 'short') yield sourceBytes.subarray(1);
        else if (kind === 'oversize')
          yield Buffer.alloc(sourceBytes.length + 1);
        else yield Buffer.alloc(sourceBytes.length);
      })();
      read.close.mockImplementation(() => {
        throw new Error('private close error');
      });
      const readFixedSource = jest.fn().mockResolvedValue({
        ...read,
        body,
        revision:
          kind === 'revision'
            ? { ...read.revision, versionId: 'other' }
            : read.revision,
      });
      await expect(
        withFixedSource(t, {
          readFixedSource,
        }).observeHistoricalFixedSource(t.anchorInput),
      ).rejects.toThrow(
        kind === 'stream failure'
          ? 'bytes could not be observed'
          : 'does not match',
      );
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(read.close).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    },
  );

  it.each(['reservation', 'digest', 'source'] as const)(
    'discards an otherwise valid read when %s changes during the stream',
    async (kind) => {
      const t = await anchorSetup();
      const read = fixedRead(t);
      const readFixedSource = jest.fn().mockResolvedValue({
        ...read,
        body: (async function* () {
          yield sourceBytes.subarray(0, 5);
          await Promise.resolve();
          if (kind === 'reservation')
            t.f.state.db.controls[0].reservationEpoch = 3;
          if (kind === 'digest') delete t.header().manifestDigest;
          if (kind === 'source') delete t.currentFile().sourceByteObservation;
          yield sourceBytes.subarray(5);
        })(),
      });
      await expect(
        withFixedSource(t, {
          readFixedSource,
        }).observeHistoricalFixedSource(t.anchorInput),
      ).rejects.toThrow();
      expect(t.readSource).toHaveBeenCalledTimes(2);
      expect(read.close).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    },
  );

  it.each([null, 'null'])(
    'requires a pinned original version (%p) before opening a body',
    async (versionId) => {
      const t = await anchorSetup(1, versionId);
      const readFixedSource = jest.fn();
      await expect(
        withFixedSource(t, {
          readFixedSource,
        }).observeHistoricalFixedSource(t.anchorInput),
      ).rejects.toThrow('explicit object version');
      expect(readFixedSource).not.toHaveBeenCalled();
    },
  );

  it.each(['at body end', 'at revalidation'] as const)(
    'rejects a fixed date that expires %s',
    async (point) => {
      const t = await anchorSetup();
      const read = fixedRead(t);
      const now = jest
        .fn()
        .mockReturnValueOnce(
          new Date(
            point === 'at body end' ? read.fixedRetainUntil : observedAt,
          ),
        )
        .mockReturnValue(new Date(read.fixedRetainUntil));
      await expect(
        withFixedSource(
          t,
          {
            readFixedSource: jest.fn().mockResolvedValue(read),
          },
          now,
        ).observeHistoricalFixedSource(t.anchorInput),
      ).rejects.toThrow();
      expect(t.readSource).toHaveBeenCalledTimes(
        point === 'at body end' ? 1 : 2,
      );
      expect(read.close).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    },
  );

  async function retentionSetup() {
    const t = await anchorSetup();
    const readSourceRetention = jest.fn().mockResolvedValue(retention);
    const observer = withRetention(t, { readSourceRetention });
    const pins = {
      anchor: t.anchorInput,
      expectedBucketOwner: retention.expectedBucketOwner,
    };
    const preparer = new ItemManifestPreparer(
      t.f.store,
      observer,
      pins.expectedBucketOwner,
    );
    return { ...t, observer, pins, preparer, readSourceRetention };
  }

  it('persists only the report in the original fenced transaction and replays it locally after its reported date', async () => {
    const t = await retentionSetup();
    const before = structuredClone(t.currentFile());
    const receipt = await t.preparer.prepareHistoricalSourceRetention(
      t.anchorInput,
    );
    expect(receipt).toMatchObject({
      replayed: false,
      observation: {
        reportedRetainUntil: retention.reportedRetainUntil,
        reservation: 'OBSERVED_ONLY',
        readability: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      },
    });
    expect(t.currentFile()).toEqual({
      ...before,
      sourceRetentionObservation: receipt.observation,
    });
    expect(t.header().manifestDigest).toEqual(t.digest);
    const writes = t.f.calls.filter((call) => call.method === 'updateOne');
    expect(writes.map((call) => call.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
      'files',
    ]);
    expect(new Set(writes.map((call) => call.session))).toEqual(
      new Set([t.f.sessions.at(-1)]),
    );
    const saved = structuredClone(t.f.state.db);
    const lateObserver = withRetention(
      t,
      { readSourceRetention: t.readSourceRetention },
      () => new Date('2028-01-01T00:00:00.000Z'),
    );
    const late = new ItemManifestPreparer(
      t.f.store,
      lateObserver,
      t.pins.expectedBucketOwner,
    );
    const replay = await late.prepareHistoricalSourceRetention(t.anchorInput);
    expect(replay).toEqual({ ...receipt, replayed: true });
    expect(Object.isFrozen(replay.observation)).toBe(true);
    expect(t.readSourceRetention).toHaveBeenCalledTimes(1);
    expect(t.f.state.db).toEqual(saved);
    expect(t.f.state.writes).toBe(5);
  });

  it('replays an exact confirmation and rejects a replacement with a fresh hash', async () => {
    const t = await retentionSetup();
    const { observation } = await t.preparer.prepareHistoricalSourceRetention(
      t.anchorInput,
    );
    const before = structuredClone(t.f.state.db);
    expect(await t.f.store.confirmSourceRetention(t.pins, observation)).toEqual(
      {
        observation,
        replayed: true,
      },
    );
    const different = buildItemSourceRetentionObservation({
      ...observation,
      reportedRetainUntil: '2027-02-01T00:00:00.000Z',
    });
    await expect(
      t.f.store.confirmSourceRetention(t.pins, different),
    ).rejects.toThrow('cannot be replaced');
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(5);
  });

  it('rejects a reader configured for another bucket owner before installing the report', async () => {
    const t = await retentionSetup();
    t.readSourceRetention.mockResolvedValue({
      ...retention,
      expectedBucketOwner: '987654321098',
    });
    const before = structuredClone(t.f.state.db);
    await expect(
      t.preparer.prepareHistoricalSourceRetention(t.anchorInput),
    ).rejects.toThrow('identity is inconsistent');
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(0);
  });

  it.each([
    'owner',
    'report',
    'status',
    'digest',
    'intent',
    'source',
    'reservation',
  ])(
    'fails closed on re-reading a persisted report with invalid %s',
    async (kind) => {
      const t = await retentionSetup();
      const { observation } = await t.preparer.prepareHistoricalSourceRetention(
        t.anchorInput,
      );
      let preparer = t.preparer;
      if (kind === 'owner')
        preparer = new ItemManifestPreparer(
          t.f.store,
          t.observer,
          '987654321098',
        );
      if (kind === 'report') t.currentFile().sourceRetentionObservation = null;
      if (kind === 'status') {
        const { observationHash: oldHash, ...definition } = observation;
        const changed = { ...definition, copyDispatch: 'AUTHORIZED' };
        const observationHash = archiveHash(changed);
        expect(observationHash).not.toBe(oldHash);
        t.currentFile().sourceRetentionObservation = {
          ...changed,
          observationHash,
        };
      }
      if (kind === 'digest') delete t.header().manifestDigest;
      if (kind === 'intent') delete t.currentFile().historicalCopyIntent;
      if (kind === 'source') delete t.currentFile().sourceByteObservation;
      if (kind === 'reservation') t.f.state.db.controls[0].reservationEpoch = 3;
      const before = structuredClone(t.f.state.db);
      await expect(
        preparer.prepareHistoricalSourceRetention(t.anchorInput),
      ).rejects.toThrow();
      expect(t.readSourceRetention).toHaveBeenCalledTimes(1);
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(5);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'rolls back fences and the report if write %i fails',
    async (write) => {
      const t = await retentionSetup();
      const before = structuredClone(t.f.state.db);
      t.f.state.failAtWrite = write;
      await expect(
        t.preparer.prepareHistoricalSourceRetention(t.anchorInput),
      ).rejects.toMatchObject({
        status: 503,
      });
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(write);
    },
  );

  it('reconciles a lost application response after confirmation without repeating the provider read', async () => {
    const t = await retentionSetup();
    const confirm = t.f.store.confirmSourceRetention.bind(t.f.store);
    jest
      .spyOn(t.f.store, 'confirmSourceRetention')
      .mockImplementationOnce((pins, observation) => {
        t.f.state.loseReply = true;
        return confirm(pins, observation);
      });
    await expect(
      t.preparer.prepareHistoricalSourceRetention(t.anchorInput),
    ).rejects.toMatchObject({
      status: 503,
    });
    const stored = t.currentFile().sourceRetentionObservation;
    expect(stored).toBeDefined();
    expect(
      await t.preparer.prepareHistoricalSourceRetention(t.anchorInput),
    ).toEqual({
      observation: stored,
      replayed: true,
    });
    expect(t.readSourceRetention).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(5);
  });

  it('refuses to repair missing predecessors around an orphan retention field', async () => {
    const t = await retentionSetup();
    t.currentFile().sourceRetentionObservation = null;
    delete t.currentFile().sourceByteObservation;
    let before = structuredClone(t.f.state.db);
    await expect(
      t.f.store.confirmSourceObservation(t.anchorInput.preparation, t.source),
    ).rejects.toThrow();
    expect(t.f.state.db).toEqual(before);
    delete t.currentFile().historicalCopyIntent;
    before = structuredClone(t.f.state.db);
    await expect(
      t.f.store.prepareHistoricalCopy(t.anchorInput.preparation),
    ).rejects.toThrow();
    expect(t.f.state.db).toEqual(before);
  });

  it('defines the report as optional without a default or index', () => {
    const path = OwnershipArchiveFileSchema.path('sourceRetentionObservation');
    expect(path.options.required).toBe(false);
    expect(path.options.default).toBeUndefined();
    expect(
      OwnershipArchiveFileSchema.indexes().some(
        ([key]) => 'sourceRetentionObservation' in key,
      ),
    ).toBe(false);
  });

  it('binds the reported protection to the original anchor after a fresh local read', async () => {
    const t = await anchorSetup();
    const anchor = await t.observer.anchorHistoricalSource(t.anchorInput);
    t.readSource.mockClear();
    const before = structuredClone(t.f.state.db);
    const readSourceRetention = jest.fn((target: ItemSourceRetentionTarget) => {
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
      expect(Object.isFrozen(target)).toBe(true);
      expect(target).toEqual({
        bucket: t.intent.bucket,
        key: t.intent.source.key,
        versionId: t.intent.source.revision.versionId,
      });
      return Promise.resolve(retention);
    });
    const result = await withRetention(t, {
      readSourceRetention,
    }).observeHistoricalSourceRetention(t.anchorInput);
    const { observationHash, ...definition } = result;
    expect(observationHash).toBe(archiveHash(definition));
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_SOURCE_RETENTION_OBSERVATION_V1',
      anchorHash: anchor.anchorHash,
      selectorHash: archiveHash({
        bucket: t.intent.bucket,
        key: t.intent.source.key,
        versionId: t.intent.source.revision.versionId,
        expectedBucketOwner: retention.expectedBucketOwner,
      }),
      mode: 'COMPLIANCE',
      observedAt,
      reportedRetainUntil: retention.reportedRetainUntil,
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      readability: 'NOT_ASSESSED',
      coverage: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(readSourceRetention).toHaveBeenCalledTimes(1);
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|123456789012|test-archive-bucket|versionId/,
    );
  });

  it.each([null, 'null'])(
    'blocks an unversioned or null source before asking the reader (%s)',
    async (versionId) => {
      const t = await anchorSetup(1, versionId);
      const readSourceRetention = jest.fn().mockResolvedValue(retention);
      await expect(
        withRetention(t, {
          readSourceRetention,
        }).observeHistoricalSourceRetention(t.anchorInput),
      ).rejects.toThrow('original explicit object version');
      expect(readSourceRetention).not.toHaveBeenCalled();
      expect(t.f.state.writes).toBe(0);
    },
  );

  it.each(['epoch', 'source', 'digest'] as const)(
    'discards provider metadata when %s changes before the final local read',
    async (kind) => {
      const t = await anchorSetup();
      const readSourceRetention = jest.fn(() => {
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'source') delete t.currentFile().sourceByteObservation;
        if (kind === 'digest') delete t.header().manifestDigest;
        return Promise.resolve(retention);
      });
      await expect(
        withRetention(t, {
          readSourceRetention,
        }).observeHistoricalSourceRetention(t.anchorInput),
      ).rejects.toThrow();
      expect(readSourceRetention).toHaveBeenCalledTimes(1);
      expect(t.readSource).toHaveBeenCalledTimes(2);
      expect(t.f.state.writes).toBe(0);
    },
  );

  it.each([observedAt, '2027-01-01T01:00:00.000+01:00'])(
    'rejects an expired or noncanonical reported date (%s)',
    async (reportedRetainUntil) => {
      const t = await anchorSetup();
      const readSourceRetention = jest
        .fn()
        .mockResolvedValue({ ...retention, reportedRetainUntil });
      await expect(
        withRetention(t, {
          readSourceRetention,
        }).observeHistoricalSourceRetention(t.anchorInput),
      ).rejects.toThrow('identity is inconsistent');
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
    },
  );

  it('does not return the observation if the reported date has elapsed by final revalidation', async () => {
    const t = await anchorSetup();
    const readSourceRetention = jest.fn().mockResolvedValue(retention);
    const now = jest
      .fn()
      .mockReturnValueOnce(new Date(observedAt))
      .mockReturnValue(new Date(retention.reportedRetainUntil));
    await expect(
      withRetention(
        t,
        { readSourceRetention },
        now,
      ).observeHistoricalSourceRetention(t.anchorInput),
    ).rejects.toThrow('invalid or expired');
    expect(t.readSource).toHaveBeenCalledTimes(2);
    expect(t.f.state.writes).toBe(0);
  });

  it('requires a composed reader and rejects evidence in the caller input before local or provider reads', async () => {
    const t = await anchorSetup();
    await expect(
      t.observer.observeHistoricalSourceRetention(t.anchorInput),
    ).rejects.toThrow('configured explicitly');
    const readSourceRetention = jest.fn().mockResolvedValue(retention);
    await expect(
      withRetention(t, {
        readSourceRetention,
      }).observeHistoricalSourceRetention({
        ...t.anchorInput,
        retention,
      } as never),
    ).rejects.toThrow('Invalid historical source anchor input');
    expect(t.read).not.toHaveBeenCalled();
    expect(readSourceRetention).not.toHaveBeenCalled();
  });

  it('finds a source on a later page and binds the final local snapshot without writes', async () => {
    const t = await anchorSetup(103);
    t.f.state.manifestBatchSize = 40;
    const before = structuredClone(t.f.state.db);
    const result = await t.observer.anchorHistoricalSource(t.anchorInput);
    const { anchorHash, ...definition } = result;
    expect(anchorHash).toBe(archiveHash(definition));
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_SOURCE_ANCHOR_V1',
      binding: t.intent.binding,
      manifestHash: t.digest.manifestHash,
      intentId: t.intent.id,
      intentDefinitionHash: t.intent.definitionHash,
      sourceObservationHash: t.source.observationHash,
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      coverage: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'FILES',
      'FILES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.readSource).toHaveBeenCalledTimes(1);
    const session = t.f.sessions.at(-1)!;
    const reads = t.f.calls.filter((call) => call.session === session);
    expect(reads.map((call) => call.role)).toEqual([
      'requests',
      'items',
      'claims',
      'archives',
      'controls',
      'periods',
      'periods',
      'files',
    ]);
    expect(
      reads.find((call) => call.role === 'archives')?.projection,
    ).toHaveProperty('manifestDigest', 1);
    expect(
      reads.find((call) => call.role === 'files')?.projection,
    ).toHaveProperty('sourceByteObservation', 1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.binding.observedSeal)).toBe(true);
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|payload|sourceKey|sha256|leaseToken/,
    );
    expect(await t.observer.anchorHistoricalSource(t.anchorInput)).toEqual(
      result,
    );
  });

  it.each(['file-id', 'file-hash', 'manifest-hash'] as const)(
    'requires the exact traversed membership and expected hash (%s)',
    async (pin) => {
      const t = await anchorSetup();
      const input = structuredClone(t.anchorInput);
      if (pin === 'file-id') input.preparation.fileId = 'f'.repeat(64);
      if (pin === 'file-hash')
        input.preparation.expectedFileDefinitionHash = 'b'.repeat(64);
      if (pin === 'manifest-hash') input.expectedManifestHash = 'c'.repeat(64);
      await expect(t.observer.anchorHistoricalSource(input)).rejects.toThrow(
        'expected manifest traversal',
      );
      expect(t.read.mock.calls.at(-1)?.[0].cursor.phase).toBe('COMPLETE');
      expect(t.readSource).not.toHaveBeenCalled();
      expect(t.f.state.writes).toBe(0);
    },
  );

  it('checks the full manifest even when the selected file still matches', async () => {
    const t = await anchorSetup();
    const row = t.f.state.db.files[0];
    expect(row.id).not.toBe(t.anchorInput.preparation.fileId);
    const { definitionHash: old, state, ...definition } = row;
    const replacement = { ...(row.source as object), versionId: 'later' };
    Object.assign(row, {
      source: replacement,
      definitionHash: archiveHash({ ...definition, source: replacement }),
    });
    expect(row.definitionHash).not.toBe(old);
    expect(state).toBe('PENDING');
    await expect(
      t.observer.anchorHistoricalSource(t.anchorInput),
    ).rejects.toThrow('expected manifest traversal');
    expect(t.readSource).not.toHaveBeenCalled();
  });

  it('cannot anchor a file in a complete zero-file manifest', async () => {
    const t = await setup(1, false);
    await expect(
      t.observer.anchorHistoricalSource({
        preparation: { ...t.f.input, ...t.input },
        expectedManifestHash: t.complete().manifestHash,
      }),
    ).rejects.toThrow('expected manifest traversal');
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.f.state.writes).toBe(0);
  });

  it.each([
    'manifest',
    'manifest-hash',
    'source',
    'source-revision',
    'intent',
    'lease',
    'epoch',
    'period',
  ] as const)(
    'rejects %s invalidation after COMPLETE in the final source snapshot',
    async (kind) => {
      const t = await anchorSetup();
      const read = t.read.getMockImplementation()!.bind(t.f.store);
      t.read.mockImplementation(async (input) => {
        const page = await read(input);
        if (page.phase !== 'COMPLETE') return page;
        if (kind === 'manifest') delete t.header().manifestDigest;
        if (kind === 'manifest-hash') {
          const { manifestHash: previousHash, ...definition } = t.digest;
          const changed = { ...definition, entriesDigest: 'b'.repeat(64) };
          const manifestHash = archiveHash(changed);
          expect(manifestHash).not.toBe(previousHash);
          t.header().manifestDigest = {
            ...changed,
            manifestHash,
          };
        }
        if (kind === 'source') delete t.currentFile().sourceByteObservation;
        if (kind === 'source-revision') {
          const observation = {
            ...t.source.observation,
            revision: {
              ...t.source.observation.revision,
              versionId: 'later',
            },
          };
          t.currentFile().sourceByteObservation = {
            ...t.source,
            observation,
            observationHash: archiveHash(observation),
          };
        }
        if (kind === 'intent') delete t.currentFile().historicalCopyIntent;
        if (kind === 'lease') t.currentFile().leaseToken = 'synthetic-lease';
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'period') t.f.state.db.periods = [];
        return page;
      });
      await expect(
        t.observer.anchorHistoricalSource(t.anchorInput),
      ).rejects.toThrow();
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
      expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );

  it('rejects caller-supplied evidence and freezes selector and pins before paging', async () => {
    const t = await anchorSetup();
    await expect(
      t.observer.anchorHistoricalSource({
        ...t.anchorInput,
        sourceObservation: t.source,
      } as never),
    ).rejects.toThrow('Invalid historical source anchor input');
    expect(t.read).not.toHaveBeenCalled();
    const mutable = structuredClone(t.anchorInput);
    const pending = t.observer.anchorHistoricalSource(mutable);
    mutable.preparation.selector.itemId = t.f.id(90);
    mutable.preparation.bucket = 'changed-bucket';
    mutable.expectedManifestHash = 'b'.repeat(64);
    expect(await pending).toMatchObject({
      binding: t.intent.binding,
      manifestHash: t.digest.manifestHash,
    });
  });

  it('propagates a session close failure after the final source snapshot', async () => {
    const t = await anchorSetup();
    const read = t.read.getMockImplementation()!.bind(t.f.store);
    t.read.mockImplementation(async (input) => {
      const page = await read(input);
      if (page.phase === 'COMPLETE') t.f.state.endFailure = true;
      return page;
    });
    await expect(
      t.observer.anchorHistoricalSource(t.anchorInput),
    ).rejects.toMatchObject({ status: 503 });
    expect(t.readSource).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });
});
