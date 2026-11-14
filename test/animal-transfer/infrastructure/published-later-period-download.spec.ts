import { Readable, Writable } from 'node:stream';
import { runInThisContext } from 'node:vm';
import {
  PublishedOwnershipHistoryDownloader,
  type PublishedHistoryDownloadMetadata,
} from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedHistoryConservationRenewer } from '../../../src/context/animal-transfer/application/published-history-conservation-renewer';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
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

async function setup() {
  const f = await publishedLaterPeriod();
  const controlsHash = archiveHash('renewed controls');
  const renewedUntil = '2026-10-30T12:00:00.000Z';
  const renewedThrough = '2026-10-30T11:00:00.000Z';
  const response = (bytes = f.bytes) => ({
    revision: f.revision,
    body: Readable.from([bytes]),
    close: jest.fn(),
  });
  const storage = {
    readVersion: jest.fn(() => Promise.resolve(response())),
    readSourceRetention: jest.fn(() =>
      Promise.resolve({
        expectedBucketOwner: f.target.expectedBucketOwner,
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
    { ...f.target, issuerId: f.recipientId, controlsHash },
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
