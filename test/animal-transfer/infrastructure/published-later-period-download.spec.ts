import { Readable, Writable } from 'node:stream';
import { runInThisContext } from 'node:vm';
import {
  PublishedOwnershipHistoryDownloader,
  type PublishedHistoryDownloadMetadata,
} from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedHistoryConservationRenewer } from '../../../src/context/animal-transfer/application/published-history-conservation-renewer';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import { buildLaterPeriodLiveMediaRecord } from '../../../src/context/animal-transfer/domain/later-period-live-media';
import { buildLaterPeriodLivePutRecord } from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

// Jest's VM on Node 20 omits the symbol used by the native abort listener.
const restoreDispose = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
beforeAll(() => {
  if (!restoreDispose)
    Object.defineProperty(Symbol, 'dispose', {
      value: runInThisContext('Symbol.dispose') as symbol,
      configurable: true,
    });
});
afterAll(() => {
  if (!restoreDispose) Reflect.deleteProperty(Symbol, 'dispose');
});

async function setup(file: 'retained' | 'own' = 'retained') {
  const f = await publishedLaterPeriod();
  const { live } = f;
  const current =
    file === 'own'
      ? {
          selection: f.liveSelection,
          bytes: live.bytes,
          target: live.media.historical.target,
          revision: live.media.historical.revision,
          originalControlsHash: live.media.historical.conservationControlsHash,
        }
      : f;
  const controlsHash = archiveHash('renewed controls');
  const renewedUntil = '2026-10-30T12:00:00.000Z';
  const renewedThrough = '2026-10-30T11:00:00.000Z';
  const response = (bytes = current.bytes) => ({
    revision: current.revision,
    body: Readable.from([bytes]),
    close: jest.fn(),
  });
  const storage = {
    readVersion: jest.fn(() => Promise.resolve(response())),
    readSourceRetention: jest.fn(() =>
      Promise.resolve({
        expectedBucketOwner: current.target.expectedBucketOwner,
        mode: 'COMPLIANCE' as const,
        reportedRetainUntil: renewedUntil,
      }),
    ),
  };
  const reader = new PublishedOwnershipHistoryReader(f.store, f.keyFromUrl);
  const download = new PublishedOwnershipHistoryDownloader(
    f.history,
    storage,
    f.keyFromUrl,
    5000,
    f.now,
  );
  const renewer = new PublishedHistoryConservationRenewer(
    f.history,
    storage,
    f.keyFromUrl,
    { ...current.target, issuerId: f.recipientId, controlsHash },
    f.now,
  );
  const chunks: Buffer[] = [];
  const open = jest.fn<Writable, [PublishedHistoryDownloadMetadata]>(
    () =>
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
  );
  return {
    ...f,
    ...current,
    reader,
    download,
    renewer,
    storage,
    response,
    open,
    chunks,
    controlsHash,
    renewedThrough,
    renewedUntil,
  };
}

describe('Published second ownership period, simulated dependencies', () => {
  it('opens its dossier and streams the exact retained version with original conservation', async () => {
    const f = await setup();
    const { actorId, periodId, publicationHash, entryId, fileId } = f.selection;
    const page = await f.reader.read({
      actorId,
      periodId,
      publicationHash,
      limit: 2,
    });
    expect(page.entries).toContainEqual(
      expect.objectContaining({
        entryId,
        kind: 'RETAINED_RECORD',
        media: [expect.objectContaining({ fileId })],
      }),
    );
    await f.download.download(f.selection, f.open);
    expect(f.storage.readVersion).toHaveBeenCalledWith(
      f.target,
      f.revision,
      expect.any(AbortSignal),
    );
    expect(f.open).toHaveBeenCalledWith({
      contentLength: f.bytes.length,
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
      cacheControl: 'private, no-store',
    });
    expect(Buffer.concat(f.chunks)).toEqual(f.bytes);
    expect(f.profiles.assertActiveSharedControls).toHaveBeenCalledWith(
      f.originalControlsHash,
      expect.anything(),
    );
    expect(f.state.writes).toBe(0);
  });

  it.each(['owner', 'publication', 'file', 'version'] as const)(
    'rejects a mismatched %s before opening storage or the destination',
    async (mismatch) => {
      const f = await setup();
      const selection = { ...f.selection };
      if (mismatch === 'owner') selection.actorId = f.recipientId;
      if (mismatch === 'publication')
        selection.publicationHash = archiveHash('other publication');
      if (mismatch === 'file') selection.fileId = archiveHash('other file');
      if (mismatch === 'version')
        f.copyFacts.historical.observation.revision = {
          ...f.revision,
          versionId: 'replacement',
        };
      const error = {
        owner: /not found/i,
        publication: /publication changed/i,
        file: /historical file not found/i,
        version: /retained versions differ from the published cut/i,
      }[mismatch];
      await expect(f.download.download(selection, f.open)).rejects.toThrow(
        error,
      );
      expect(f.storage.readVersion).not.toHaveBeenCalled();
      expect(f.open).not.toHaveBeenCalled();
    },
  );

  it('records and replays a verified renewal, then downloads only while its controls and horizon hold', async () => {
    const f = await setup();
    f.setTime('2026-10-29T12:07:00.000Z');
    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      'The historical PUT version evidence is inconsistent',
    );
    expect(f.storage.readVersion).not.toHaveBeenCalled();
    const inquiry = { ...f.selection, requiredThrough: f.renewedThrough };
    const receipt = await f.renewer.renew(inquiry, null);
    expect(receipt.replayed).toBe(false);
    expect(f.state.writes).toBe(1);
    expect(f.storage.readSourceRetention).toHaveBeenCalledWith({
      bucket: f.target.bucket,
      key: f.target.key,
      versionId: f.revision.versionId,
    });
    expect(f.storage.readVersion).toHaveBeenCalledWith(f.target, f.revision);
    expect(f.profiles.fenceActiveSharedControls).toHaveBeenCalledWith(
      f.controlsHash,
      expect.anything(),
    );
    await expect(
      f.renewer.replay(inquiry, receipt.evidenceHash),
    ).resolves.toEqual({
      ...receipt,
      replayed: true,
    });
    expect(f.storage.readVersion).toHaveBeenCalledTimes(1);
    expect(f.state.writes).toBe(1);

    await f.download.download(f.selection, f.open);
    expect(Buffer.concat(f.chunks)).toEqual(f.bytes);
    expect(f.storage.readVersion).toHaveBeenLastCalledWith(
      f.target,
      f.revision,
      expect.any(AbortSignal),
    );
    expect(f.profiles.assertActiveSharedControls).toHaveBeenLastCalledWith(
      f.controlsHash,
      expect.anything(),
    );
    f.profiles.assertActiveSharedControls.mockRejectedValueOnce(
      new Error('Inactive controls'),
    );
    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      'Inactive controls',
    );
    f.setTime(f.renewedUntil);
    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      /conservation/i,
    );
    expect(f.storage.readVersion).toHaveBeenCalledTimes(2);
    expect(f.open).toHaveBeenCalledTimes(1);
  });

  it('rejects a renewal with damaged bytes and withholds the last byte on a damaged download', async () => {
    const f = await setup();
    const damaged = Buffer.from(f.bytes);
    damaged[0] ^= 1;
    const renewal = f.response(damaged);
    f.storage.readVersion.mockResolvedValueOnce(renewal);
    await expect(
      f.renewer.renew(
        { ...f.selection, requiredThrough: f.renewedThrough },
        null,
      ),
    ).rejects.toThrow(/version or conservation window changed/i);
    expect(renewal.close).toHaveBeenCalledTimes(1);
    expect(f.state.writes).toBe(0);
    expect(f.profiles.fenceActiveSharedControls).not.toHaveBeenCalled();

    const download = f.response(damaged);
    f.storage.readVersion.mockResolvedValueOnce(download);
    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      /download could not be verified/i,
    );
    expect(Buffer.concat(f.chunks)).toEqual(damaged.subarray(0, -1));
    expect(download.close).toHaveBeenCalledTimes(1);
  });
});

describe('Files created during the published second period', () => {
  it('exposes an opaque file reference and reads only the archived copy', async () => {
    const f = await setup('own');
    const { actorId, periodId, publicationHash, entryId, fileId } = f.selection;
    const page = await f.reader.read({
      actorId,
      periodId,
      publicationHash,
      limit: 2,
    });
    const entry = page.entries.find((row) => row.entryId === entryId)!;
    expect(entry).toMatchObject({ kind: 'ANIMAL', media: [{ fileId }] });
    expect(entry.data).not.toHaveProperty('profilePictureUrl');
    expect(JSON.stringify(entry)).not.toContain(f.live.media.final.target.key);

    const read = f.response();
    f.storage.readVersion.mockResolvedValueOnce(read);
    await f.download.download(f.selection, f.open);
    expect(f.storage.readVersion).toHaveBeenCalledTimes(1);
    expect(f.storage.readVersion).toHaveBeenCalledWith(
      f.target,
      f.revision,
      expect.any(AbortSignal),
    );
    expect(Buffer.concat(f.chunks)).toEqual(f.bytes);
    expect(read.close).toHaveBeenCalledTimes(1);
    expect(f.profiles.assertActiveSharedControls).toHaveBeenCalledWith(
      f.originalControlsHash,
      expect.anything(),
    );
    expect(f.state.writes).toBe(0);
  });

  it('requires the file to belong to the selected entry', async () => {
    const f = await setup('own');
    const retained = f.state.db.entries.find(
      (row) => row.kind === 'RETAINED_RECORD',
    )!;
    await expect(
      f.download.download(
        {
          ...f.selection,
          entryId: String(retained.id),
        },
        f.open,
      ),
    ).rejects.toThrow('Historical file not found');
    expect(f.storage.readVersion).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });

  it('rejects a replacement version even with a valid evidence row when it differs from the joint cut', async () => {
    const f = await setup('own');
    const { record } = f.live;
    const replacement = buildLaterPeriodLiveMediaRecord(
      record.scope,
      {
        ...record.liveMediaEvidence,
        historical: {
          ...record.liveMediaEvidence.historical,
          revision: { ...f.revision, versionId: 'another-historical-version' },
        },
      },
      record.recordedAt,
    );
    const { copyRecords } = f.state.db;
    copyRecords[copyRecords.findIndex((row) => row.id === record.id)] =
      replacement;

    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      'The historical version does not match the published dossier',
    );
    expect(f.storage.readVersion).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });

  it.each(['historicalPut', 'finalPut'] as const)(
    'requires the persisted permission for %s',
    async (leg) => {
      const f = await setup('own');
      const { id, livePut } = f.live[leg];
      const { copyRecords } = f.state.db;
      copyRecords[copyRecords.findIndex((row) => row.id === id)] =
        buildLaterPeriodLivePutRecord(livePut.declaration);
      await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
        'The live media report requires both original PUT permissions',
      );
      expect(f.storage.readVersion).not.toHaveBeenCalled();
      expect(f.open).not.toHaveBeenCalled();
    },
  );

  it('renews the historical version when the original evidence stops covering the requested window', async () => {
    const f = await setup('own');
    f.setTime('2026-10-29T12:07:00.000Z');
    await expect(f.download.download(f.selection, f.open)).rejects.toThrow(
      /conservation evidence/i,
    );
    expect(f.storage.readVersion).not.toHaveBeenCalled();

    await f.renewer.renew(
      { ...f.selection, requiredThrough: f.renewedThrough },
      null,
    );
    expect(f.storage.readSourceRetention).toHaveBeenCalledWith({
      bucket: f.target.bucket,
      key: f.target.key,
      versionId: f.revision.versionId,
    });
    expect(f.storage.readVersion).toHaveBeenCalledWith(f.target, f.revision);
    expect(f.state.writes).toBe(1);

    await f.download.download(f.selection, f.open);
    expect(Buffer.concat(f.chunks)).toEqual(f.bytes);
    expect(f.storage.readVersion).toHaveBeenLastCalledWith(
      f.target,
      f.revision,
      expect.any(AbortSignal),
    );
    expect(f.profiles.assertActiveSharedControls).toHaveBeenLastCalledWith(
      f.controlsHash,
      expect.anything(),
    );
    expect(f.state.writes).toBe(1);
  });
});
