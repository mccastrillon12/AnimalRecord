import { addAbortListener } from 'node:events';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  PublishedHistoryFileInput,
  PublishedHistoryVersionSource,
  publishedHistoryVersionInput,
} from '../domain/published-ownership-history';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import type { ItemHistoricalPutVersionReader } from '../domain/transfer-item-historical-put-reconciliation';
import { historicalObjectByteVerifier } from './item-historical-copy-observer';

export type PublishedHistoryDownloadMetadata = Readonly<{
  contentLength: number;
  contentType: 'application/octet-stream';
  contentDisposition: 'attachment';
  cacheControl: 'private, no-store';
}>;

const invalid = () =>
  new ConflictError('The published historical download could not be verified');

/** Explicit backend composition. The budget belongs to the server, not the requester. */
export class PublishedOwnershipHistoryDownloader {
  constructor(
    private readonly history: PublishedHistoryVersionSource,
    private readonly storage: ItemHistoricalPutVersionReader,
    private readonly keyFromUrl: (url: string) => string | undefined,
    private readonly maxDurationMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    // Node timers clamp larger delays to 1 ms.
    if (
      !Number.isInteger(maxDurationMs) ||
      maxDurationMs < 1 ||
      maxDurationMs > 2_147_483_647
    )
      throw new InvalidArgumentError('Invalid historical download time budget');
  }

  async download(
    raw: PublishedHistoryFileInput,
    openDestination: (metadata: PublishedHistoryDownloadMetadata) => Writable,
    disconnected?: AbortSignal,
  ): Promise<void> {
    const timer = AbortSignal.timeout(this.maxDurationMs);
    const signal = disconnected
      ? AbortSignal.any([timer, disconnected])
      : timer;
    const startedAt = this.now().getTime();
    const horizon = new Date(startedAt + this.maxDurationMs);
    if (!Number.isFinite(horizon.getTime())) throw invalid();
    const input = publishedHistoryVersionInput({
      ...raw,
      requiredThrough: horizon.toISOString(),
    });
    const checkWindow = () => {
      signal.throwIfAborted();
      const current = this.now().getTime();
      if (!(startedAt <= current && current < horizon.getTime()))
        throw new ConflictError(
          'The historical download window is no longer valid',
        );
    };

    checkWindow();
    const version = await this.history.readPublishedHistoryFileVersion(
      input,
      this.keyFromUrl,
    );
    checkWindow();
    const revision = captureItemObjectRevision(version.revision);
    if (
      version.requiredThrough !== input.requiredThrough ||
      !isPinnedItemSourceVersion(revision.versionId) ||
      !sourceHashValid(version.sha256)
    )
      throw invalid();
    const read = await this.storage.readVersion(
      version.target,
      revision,
      signal,
    );
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      read.close();
    };
    const closeAfterFailure = () => {
      try {
        close();
      } catch {
        // Keep the error that stopped the download.
      }
    };
    const listener = addAbortListener(signal, closeAfterFailure);
    try {
      checkWindow();
      const verifier = historicalObjectByteVerifier(
        read.revision,
        revision,
        version.sha256,
        invalid,
      );
      const output = openDestination(
        Object.freeze({
          contentLength: revision.size,
          contentType: 'application/octet-stream',
          contentDisposition: 'attachment',
          cacheControl: 'private, no-store',
        }),
      );
      if (output.destroyed || output.writableEnded)
        throw new ConflictError(
          'The historical download destination is closed',
        );
      const verifiedBody = async function* () {
        let finalByte = 0;
        for await (const chunk of read.body) {
          checkWindow();
          const { bytes, received } = verifier.append(chunk, true);
          if (!bytes.byteLength) continue;
          if (received === revision.size) {
            // A client must not receive a complete body before size and digest match.
            finalByte = bytes[bytes.byteLength - 1];
            if (bytes.byteLength > 1) yield bytes.subarray(0, -1);
          } else {
            yield bytes;
          }
        }
        verifier.finish();
        close();
        checkWindow();
        yield Uint8Array.of(finalByte);
      };
      output.once('close', closeAfterFailure);
      output.once('error', closeAfterFailure);
      try {
        await pipeline(verifiedBody(), output, { signal });
      } finally {
        output.removeListener('close', closeAfterFailure);
        output.removeListener('error', closeAfterFailure);
      }
    } catch (error) {
      closeAfterFailure();
      throw error;
    } finally {
      listener[Symbol.dispose]();
    }
  }
}
