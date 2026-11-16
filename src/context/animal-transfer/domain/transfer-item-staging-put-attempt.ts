import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyIntentContext,
  buildItemHistoricalCopyIntent,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import {
  persistedItemStagingIntent,
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import {
  ItemHistoricalPutVersionContext,
  buildStagingFromHistoricalPutVersion,
  matchHistoricalPutVersionRecord,
} from './transfer-item-historical-put-reconciliation';

export type ItemStagingPutAttemptInput = Readonly<{
  attemptId: string;
  dispatcherInstanceId: string;
  expectedManifestHash: string;
  expectedStagingIntentHash: string;
}>;

const invalid = () =>
  new ConflictError(
    'The staging PUT attempt does not match its original historical version',
  );

/** Local definition only. The read and destination PUT are separate effects. */
export function buildItemStagingPutAttempt(
  context: ItemCopyIntentContext,
  original: ItemHistoricalPutVersionContext,
  input: ItemStagingPutAttemptInput,
) {
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'attemptId,dispatcherInstanceId,expectedManifestHash,expectedStagingIntentHash' ||
    ![input.attemptId, input.dispatcherInstanceId].every(profileIdValid) ||
    ![input.expectedManifestHash, input.expectedStagingIntentHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  const { attemptId, dispatcherInstanceId, expectedManifestHash } = input;
  const { definition: historicalAttempt, permission, versionRecord } = original;
  const { definitionHash, ...historicalFacts } = historicalAttempt;
  const originalIds = [
    historicalAttempt.id,
    historicalAttempt.dispatcherInstanceId,
    permission.authorizationId,
  ];
  if (
    !versionRecord ||
    historicalAttempt.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
    archiveHash(historicalFacts) !== definitionHash ||
    attemptId === dispatcherInstanceId ||
    originalIds.includes(attemptId) ||
    originalIds.includes(dispatcherInstanceId)
  )
    throw invalid();
  const record = matchHistoricalPutVersionRecord(original, versionRecord);
  const intent = persistedItemStagingIntent(context);
  const source = intent.predecessor?.historicalPutVersion;
  if (!source || intent.definitionHash !== input.expectedStagingIntentHash)
    throw invalid();
  const rebuilt = buildStagingFromHistoricalPutVersion(
    context,
    buildItemHistoricalCopyIntent(context),
    expectedManifestHash,
    { ...original, versionRecord: record },
    source,
  );
  if (rebuilt.intent.definitionHash !== intent.definitionHash) throw invalid();

  const { bucket, key, expectedBucketOwner } = record.observation.scope.target;
  const { etag, versionId, size } = intent.source.revision;
  if (!isPinnedItemSourceVersion(versionId)) throw invalid();
  const { contentType, contentEncoding, contentLanguage, contentDisposition } =
    historicalAttempt.request;
  const definition = {
    protocol: 'ITEM_STAGING_PUT_ATTEMPT_V1' as const,
    id: attemptId,
    dispatcherInstanceId,
    kind: 'RECIPIENT_STAGING' as const,
    origin: 'INITIAL' as const,
    ordinal: 1 as const,
    operation: 'PUT_OBJECT' as const,
    copyIntentId: intent.id,
    copyIntentDefinitionHash: intent.definitionHash,
    binding: intent.binding,
    manifestHash: expectedManifestHash,
    predecessor: source,
    metadataHash: historicalAttempt.metadataHash,
    read: Object.freeze({
      bucket,
      key,
      expectedBucketOwner,
      versionId,
      ifMatch: etag,
      contentLength: size,
      sha256: intent.source.sha256,
    }),
    request: Object.freeze({
      bucket: intent.bucket,
      key: intent.destination.key,
      expectedBucketOwner,
      ifNoneMatch: intent.destination.ifNoneMatch,
      contentLength: size,
      checksumSHA256: Buffer.from(intent.source.sha256, 'hex').toString(
        'base64',
      ),
      contentType,
      ...(contentEncoding === undefined ? {} : { contentEncoding }),
      ...(contentLanguage === undefined ? {} : { contentLanguage }),
      ...(contentDisposition === undefined ? {} : { contentDisposition }),
      cacheControl: 'private, no-store' as const,
    }),
    reservation: 'OBSERVED_ONLY' as const,
    stableCut: 'NOT_ASSESSED' as const,
    retention: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    definitionHash: archiveHash(definition),
  });
}

export type ItemStagingPutAttempt = ReturnType<
  typeof buildItemStagingPutAttempt
>;

export function matchItemStagingPutAttempt(
  context: ItemCopyIntentContext,
  original: ItemHistoricalPutVersionContext,
  input: ItemStagingPutAttemptInput,
  stored: ItemStagingPutAttempt,
  expectedDefinitionHash: string,
) {
  const expected = buildItemStagingPutAttempt(context, original, input);
  if (
    expected.definitionHash !== expectedDefinitionHash ||
    !isDeepStrictEqual(stored, expected)
  )
    throw invalid();
  return expected;
}
