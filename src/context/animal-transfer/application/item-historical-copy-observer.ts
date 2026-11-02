import { createHash } from 'node:crypto';
import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { archiveHash, ObjectRevision } from '../domain/ownership-archive';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import {
  ItemHistoricalCopyPreparationInput,
  buildItemHistoricalCopyIntent,
  historicalCopyPreparationInput,
} from '../domain/transfer-item-copy-intent';
import {
  HistoricalReadHead,
  HistoricalReadRevision,
  ItemHistoricalByteObservation,
  ItemHistoricalObjectReader,
} from '../domain/transfer-item-historical-observation';

const conflict = () =>
  new ConflictError(
    'Historical object observation does not match the original intent',
  );
function revision(value: HistoricalReadRevision): Readonly<ObjectRevision> {
  const text = (v: unknown) =>
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 1024 &&
    !/[\r\n\0]/.test(v);
  if (
    !value ||
    !text(value.etag) ||
    !Number.isSafeInteger(value.size) ||
    value.size! < 1 ||
    (value.versionId !== undefined && !text(value.versionId))
  )
    throw conflict();
  return Object.freeze({
    etag: value.etag!,
    size: value.size!,
    ...(value.versionId === undefined ? {} : { versionId: value.versionId }),
  });
}

/** Explicit composition only. No SDK, Nest provider, persistence, copying or dispatch. */
export class ItemHistoricalCopyObserver {
  constructor(
    private readonly store: Pick<ItemCaptureStore, 'readHistoricalCopy'>,
    private readonly reader: ItemHistoricalObjectReader,
  ) {}
  async observe(
    raw: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemHistoricalByteObservation> {
    const input = historicalCopyPreparationInput(raw);
    // readHistoricalCopy closes its read transaction before returning; no remote I/O inside it.
    const context = await this.store.readHistoricalCopy(input);
    const intent = buildItemHistoricalCopyIntent(context);
    if (
      archiveHash(context.selector) !== archiveHash(input.selector) ||
      intent.binding.fileId !== input.fileId ||
      intent.binding.fileDefinitionHash !== input.expectedFileDefinitionHash ||
      intent.binding.observedSealHash !== input.expectedSealHash ||
      intent.bucket !== input.bucket ||
      intent.source.sha256 !== input.sourceSha256 ||
      context.file.historicalCopyIntent === undefined ||
      archiveHash(context.file.historicalCopyIntent) !== archiveHash(intent)
    )
      throw conflict();
    // The builder detaches/freezes every relevant value before the first reader await.
    const target = Object.freeze({
      bucket: intent.bucket,
      key: intent.destination.key,
    });
    const headRevision = (head: HistoricalReadHead | null) => {
      if (
        !head ||
        head.bucket !== target.bucket ||
        head.key !== target.key ||
        head.size !== intent.source.revision.size
      )
        throw conflict();
      return revision(head);
    };
    let fixed: Readonly<ObjectRevision>;
    try {
      fixed = headRevision(await this.reader.head(target));
      const read = await this.reader.read(target, fixed);
      let failed = false;
      let readFailure: unknown;
      try {
        if (archiveHash(revision(read.revision)) !== archiveHash(fixed))
          throw conflict();
        let size = 0;
        const digest = createHash('sha256');
        for await (const chunk of read.body) {
          if (
            !(chunk instanceof Uint8Array) ||
            chunk.byteLength > fixed.size - size
          )
            throw conflict();
          size += chunk.byteLength;
          digest.update(chunk);
        }
        if (
          size !== fixed.size ||
          digest.digest('hex') !== intent.source.sha256
        )
          throw conflict();
      } catch (error) {
        failed = true;
        readFailure = error;
      } finally {
        try {
          read.close();
        } catch (error) {
          if (!failed) {
            failed = true;
            readFailure = error;
          }
        }
      }
      if (failed) throw readFailure;
      if (
        archiveHash(headRevision(await this.reader.head(target))) !==
        archiveHash(fixed)
      )
        throw conflict();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'Historical object bytes could not be observed',
      );
    }
    const observation = Object.freeze({
      intentId: intent.id,
      intentDefinitionHash: intent.definitionHash,
      bucket: target.bucket,
      key: target.key,
      revision: fixed,
      sha256: intent.source.sha256,
    });
    return Object.freeze({
      protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
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
    });
  }
}
