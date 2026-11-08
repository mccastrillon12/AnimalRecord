import { isDeepStrictEqual } from 'node:util';
import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyIntentContext,
  ItemHistoricalSourceAnchorMaterial,
  buildItemHistoricalCopyIntent,
  buildItemHistoricalSourceAnchor,
} from './transfer-item-copy-intent';
import {
  ItemSourceProfileRecord,
  assertItemSourceProfileWindow,
  captureItemSourceProfileRecord,
  matchSourceByteObservation,
  sourceHashValid,
  sourceRetentionSelectorHash,
} from './transfer-item-historical-observation';
import {
  ItemSourceArtifactSeal,
  captureItemSourceArtifactSeal,
} from './transfer-item-source-artifact';

export type ItemHistoricalPutAttemptInput = Readonly<{
  attemptId: string;
  dispatcherInstanceId: string;
  expectedBucketOwner: string;
  profile: ItemSourceProfileRecord;
  anchor: ItemHistoricalSourceAnchorMaterial;
  artifact: ItemSourceArtifactSeal;
}>;

const conflict = () =>
  new ConflictError(
    'The historical PUT attempt does not match the original source and artifact',
  );

const canonicalUuid = (id: string) =>
  typeof id === 'string' && isUuid(id) && id === id.toLowerCase();

/** Uses the anchor returned by the guarded reader. Availability and permission are separate checks. */
export function buildItemHistoricalPutAttempt(
  context: ItemCopyIntentContext,
  input: ItemHistoricalPutAttemptInput,
) {
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'anchor,artifact,attemptId,dispatcherInstanceId,expectedBucketOwner,profile' ||
    !canonicalUuid(input.attemptId) ||
    !canonicalUuid(input.dispatcherInstanceId)
  )
    throw conflict();

  const { attemptId, dispatcherInstanceId, expectedBucketOwner, anchor } =
    input;
  const artifact = captureItemSourceArtifactSeal(input.artifact);
  const profile = captureItemSourceProfileRecord(input.profile);
  const intent = buildItemHistoricalCopyIntent(context);
  const source = context.file.sourceByteObservation;
  if (!source || !sourceHashValid(anchor?.manifestHash)) throw conflict();
  const { manifestHash } = anchor;
  const { observationHash: sourceObservationHash } = matchSourceByteObservation(
    context,
    source,
  );
  const material = {
    binding: intent.binding,
    manifestHash,
    intentId: intent.id,
    intentDefinitionHash: intent.definitionHash,
    sourceObservationHash,
    source: { bucket: intent.bucket, ...intent.source },
  };
  if (archiveHash(anchor) !== archiveHash(material)) throw conflict();
  const { anchorHash } = buildItemHistoricalSourceAnchor(material);
  const selectorHash = sourceRetentionSelectorHash(
    material.source,
    expectedBucketOwner,
  );
  if (
    profile.state !== 'ACTIVE' ||
    profile.selectorHash !== selectorHash ||
    artifact.profileDefinitionHash !== profile.definitionHash ||
    artifact.expectedBucketOwner !== expectedBucketOwner ||
    artifact.anchorHash !== anchorHash ||
    artifact.selectorHash !== selectorHash ||
    artifact.size !== intent.source.revision.size ||
    artifact.sha256 !== intent.source.sha256
  )
    throw conflict();
  assertItemSourceProfileWindow(profile, Date.parse(artifact.observedAt));

  const definition = {
    protocol: 'ITEM_HISTORICAL_PUT_ATTEMPT_V1' as const,
    id: attemptId,
    dispatcherInstanceId,
    kind: 'HISTORICAL' as const,
    origin: 'INITIAL' as const,
    ordinal: 1 as const,
    operation: 'PUT_OBJECT' as const,
    copyIntentId: intent.id,
    copyIntentDefinitionHash: intent.definitionHash,
    binding: intent.binding,
    manifestHash,
    profile: Object.freeze({
      id: profile.id,
      revision: profile.revision,
      definitionHash: profile.definitionHash,
    }),
    artifact,
    request: Object.freeze({
      bucket: intent.bucket,
      key: intent.destination.key,
      expectedBucketOwner,
      ifNoneMatch: intent.destination.ifNoneMatch,
      contentLength: artifact.size,
      checksumSHA256: Buffer.from(artifact.sha256, 'hex').toString('base64'),
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

export type ItemHistoricalPutAttempt = ReturnType<
  typeof buildItemHistoricalPutAttempt
>;

export function matchItemHistoricalPutAttempt(
  context: ItemCopyIntentContext,
  input: ItemHistoricalPutAttemptInput,
  stored: ItemHistoricalPutAttempt,
  expectedDefinitionHash: string,
) {
  const expected = buildItemHistoricalPutAttempt(context, input);
  if (
    expected.definitionHash !== expectedDefinitionHash ||
    !isDeepStrictEqual(stored, expected)
  )
    throw conflict();
  return expected;
}
