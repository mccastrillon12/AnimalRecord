import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyIntentContext,
  ItemPutVersionSource,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import { captureItemSourceRepresentation } from './transfer-item-source-artifact-metadata';
import {
  ItemStagingPutVersionContext,
  buildFinalFromStagingPutVersion,
} from './transfer-item-staging-put-reconciliation';

export type ItemRecipientFinalPutAttemptInput = Readonly<{
  attemptId: string;
  dispatcherInstanceId: string;
  expectedManifestHash: string;
  expectedFinalIntentHash: string;
  source: ItemPutVersionSource;
}>;

const invalid = () =>
  new ConflictError(
    'The final PUT attempt does not match the original staging version and final intent',
  );

/** Defines an initial attempt from matched local records. No permission is granted. */
export function buildItemRecipientFinalPutAttempt(
  context: ItemCopyIntentContext,
  original: ItemStagingPutVersionContext,
  input: ItemRecipientFinalPutAttemptInput,
) {
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'attemptId,dispatcherInstanceId,expectedFinalIntentHash,expectedManifestHash,source' ||
    ![input.attemptId, input.dispatcherInstanceId].every(profileIdValid) ||
    ![input.expectedFinalIntentHash, input.expectedManifestHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  const { attemptId, dispatcherInstanceId, expectedManifestHash, source } =
    input;
  const { definition: staging, permission } = original;
  const priorIds = [
    staging.id,
    staging.dispatcherInstanceId,
    permission.authorizationId,
    staging.predecessor.attemptId,
    staging.predecessor.authorizationId,
  ];
  if (
    staging.protocol !== 'ITEM_STAGING_PUT_ATTEMPT_V1' ||
    !sourceHashValid(staging.metadataHash) ||
    attemptId === dispatcherInstanceId ||
    priorIds.includes(attemptId) ||
    priorIds.includes(dispatcherInstanceId)
  )
    throw invalid();
  const { intent, versionRecord } = buildFinalFromStagingPutVersion(
    context,
    expectedManifestHash,
    original,
    source,
  );
  if (
    intent.definitionHash !== input.expectedFinalIntentHash ||
    !isDeepStrictEqual(context.file.recipientFinalCopyIntent, intent)
  )
    throw invalid();

  const { key, expectedBucketOwner, revision, sha256 } = intent.source;
  const { etag, versionId, size } = revision;
  if (!isPinnedItemSourceVersion(versionId)) throw invalid();
  const { contentType, contentEncoding, contentLanguage, contentDisposition } =
    staging.request;
  const representation = captureItemSourceRepresentation({
    contentType,
    contentEncoding,
    contentLanguage,
    contentDisposition,
  });
  const definition = {
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1' as const,
    id: attemptId,
    dispatcherInstanceId,
    kind: intent.kind,
    origin: 'INITIAL' as const,
    ordinal: 1 as const,
    operation: 'PUT_OBJECT' as const,
    copyIntentId: intent.id,
    copyIntentDefinitionHash: intent.definitionHash,
    binding: intent.binding,
    manifestHash: intent.manifestHash,
    predecessor: intent.predecessor.stagingPutVersion,
    metadataHash: staging.metadataHash,
    read: Object.freeze({
      bucket: intent.bucket,
      key,
      expectedBucketOwner,
      versionId,
      ifMatch: etag,
      contentLength: size,
      sha256,
    }),
    request: Object.freeze({
      bucket: intent.bucket,
      key: intent.destination.key,
      expectedBucketOwner,
      ifNoneMatch: intent.destination.ifNoneMatch,
      contentLength: size,
      checksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      ...representation,
      cacheControl: 'private, no-store' as const,
    }),
    reservation: 'OBSERVED_ONLY' as const,
    stableCut: 'NOT_ASSESSED' as const,
    retention: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    definition: Object.freeze({
      ...definition,
      definitionHash: archiveHash(definition),
    }),
    versionRecord,
  });
}

export type ItemRecipientFinalPutAttempt = ReturnType<
  typeof buildItemRecipientFinalPutAttempt
>['definition'];
