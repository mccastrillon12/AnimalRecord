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
  HistoricalObjectRead,
  HistoricalReadHead,
  HistoricalReadRevision,
  ItemHistoricalByteObservation,
  ItemSourceByteObservation,
  ItemHistoricalObjectReader,
  ItemStagingByteObservation,
  persistedItemStagingIntent,
} from '../domain/transfer-item-historical-observation';

const conflict = () =>
  new ConflictError(
    'Historical object observation does not match the original intent',
  );
function revision(
  value: HistoricalReadRevision,
  fail = conflict,
): Readonly<ObjectRevision> {
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
    throw fail();
  return Object.freeze({
    etag: value.etag!,
    size: value.size!,
    ...(value.versionId === undefined ? {} : { versionId: value.versionId }),
  });
}

export function historicalObjectByteVerifier(
  observed: HistoricalReadRevision,
  fixed: Readonly<ObjectRevision>,
  sha256: string,
  fail: () => ConflictError,
) {
  if (archiveHash(revision(observed, fail)) !== archiveHash(fixed))
    throw fail();
  let size = 0;
  const digest = createHash('sha256');
  return {
    append(chunk: Uint8Array, copy: boolean) {
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.byteLength > fixed.size - size
      )
        throw fail();
      const bytes = copy ? Uint8Array.from(chunk) : chunk;
      size += bytes.byteLength;
      digest.update(bytes);
      return { bytes, received: size };
    },
    finish() {
      if (size !== fixed.size || digest.digest('hex') !== sha256) throw fail();
    },
  };
}

export async function verifyHistoricalObjectBytes(
  read: HistoricalObjectRead,
  fixed: Readonly<ObjectRevision>,
  sha256: string,
  fail: () => ConflictError,
  writeCandidate?: (bytes: Uint8Array) => Promise<void>,
) {
  let failure: { error: unknown } | undefined;
  try {
    const verifier = historicalObjectByteVerifier(
      read.revision,
      fixed,
      sha256,
      fail,
    );
    for await (const chunk of read.body) {
      const { bytes } = verifier.append(chunk, Boolean(writeCandidate));
      if (writeCandidate) await writeCandidate(bytes);
    }
    verifier.finish();
  } catch (error) {
    failure = { error };
  } finally {
    try {
      read.close();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}

/** Explicit composition only. No SDK, Nest provider, persistence, copying or dispatch. */
export class ItemHistoricalCopyObserver {
  constructor(
    private readonly store: Pick<
      ItemCaptureStore,
      'readHistoricalCopy' | 'readStagingCopy'
    >,
    private readonly reader: ItemHistoricalObjectReader,
  ) {}
  observe(
    raw: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemHistoricalByteObservation> {
    return this.observeTarget(raw, 'HISTORICAL');
  }
  observeSource(
    raw: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemSourceByteObservation> {
    return this.observeTarget(raw, 'SOURCE');
  }
  observeStaging(
    raw: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemStagingByteObservation> {
    return this.observeTarget(raw, 'STAGING');
  }
  private observeTarget(
    raw: ItemHistoricalCopyPreparationInput,
    kind: 'STAGING',
  ): Promise<ItemStagingByteObservation>;
  private observeTarget(
    raw: ItemHistoricalCopyPreparationInput,
    kind: 'HISTORICAL',
  ): Promise<ItemHistoricalByteObservation>;
  private observeTarget(
    raw: ItemHistoricalCopyPreparationInput,
    kind: 'SOURCE',
  ): Promise<ItemSourceByteObservation>;
  private async observeTarget(
    raw: ItemHistoricalCopyPreparationInput,
    kind: 'HISTORICAL' | 'SOURCE' | 'STAGING',
  ) {
    const source = kind === 'SOURCE';
    const fail = source
      ? () =>
          new ConflictError(
            'Source object observation does not match the original manifest revision and intent',
          )
      : kind === 'STAGING'
        ? () =>
            new ConflictError(
              'Staging object observation does not match the original intent and predecessor',
            )
        : conflict;
    const input = historicalCopyPreparationInput(raw);
    // Both store reads close their read transaction before returning; no remote I/O inside it.
    const context = await (kind === 'STAGING'
      ? this.store.readStagingCopy(input)
      : this.store.readHistoricalCopy(input));
    const historical = buildItemHistoricalCopyIntent(context);
    const intent =
      kind === 'STAGING' ? persistedItemStagingIntent(context) : historical;
    if (
      archiveHash(context.selector) !== archiveHash(input.selector) ||
      intent.binding.fileId !== input.fileId ||
      intent.binding.fileDefinitionHash !== input.expectedFileDefinitionHash ||
      intent.binding.observedSealHash !== input.expectedSealHash ||
      intent.bucket !== input.bucket ||
      intent.source.sha256 !== input.sourceSha256 ||
      context.file.historicalCopyIntent === undefined ||
      archiveHash(context.file.historicalCopyIntent) !== archiveHash(historical)
    )
      throw fail();
    // The builder detaches/freezes every relevant value before the first reader await.
    const target = Object.freeze({
      bucket: intent.bucket,
      key: source ? intent.source.key : intent.destination.key,
    });
    const headRevision = (head: HistoricalReadHead | null) => {
      if (
        !head ||
        head.bucket !== target.bucket ||
        head.key !== target.key ||
        head.size !== intent.source.revision.size
      )
        throw fail();
      return revision(head, fail);
    };
    let fixed: Readonly<ObjectRevision>;
    try {
      fixed = headRevision(await this.reader.head(target));
      // Source reads must retain the original captured revision. A new HEAD pin
      // cannot replace it, even if an older version could still be retrieved.
      if (source && archiveHash(fixed) !== archiveHash(intent.source.revision))
        throw fail();
      const read = await this.reader.read(target, fixed);
      await verifyHistoricalObjectBytes(
        read,
        fixed,
        intent.source.sha256,
        fail,
      );
      if (
        archiveHash(headRevision(await this.reader.head(target))) !==
        archiveHash(fixed)
      )
        throw fail();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        source
          ? 'Source object bytes could not be observed'
          : kind === 'STAGING'
            ? 'Staging object bytes could not be observed'
            : 'Historical object bytes could not be observed',
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
    const common = {
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
    } as const;
    return source
      ? Object.freeze({
          protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1' as const,
          ...common,
        })
      : kind === 'STAGING'
        ? Object.freeze({
            protocol: 'ITEM_STAGING_BYTE_OBSERVATION_V1' as const,
            ...common,
          })
        : Object.freeze({
            protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1' as const,
            ...common,
          });
  }
}
