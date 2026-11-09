import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemArchiveCopyIntent,
  ItemCopyIntentContext,
  buildItemHistoricalCopyIntent,
} from './transfer-item-copy-intent';
import { persistedItemStagingIntent } from './transfer-item-historical-observation';

export const ITEM_COPY_ATTEMPT_PROTOCOL =
  'ITEM_COPY_ATTEMPT_INTENT_V1' as const;
type Origin = 'INITIAL' | 'APPLICATION_RETRY' | 'SDK_RETRY';
type Previous = Readonly<{
  attemptId: string;
  attemptDefinitionHash: string;
  authorizationId: string;
}>;
/** Flat definition only, NOT a durable attempt, grant or transport capability. */
export type ItemCopyAttemptIntent = Readonly<{
  protocol: typeof ITEM_COPY_ATTEMPT_PROTOCOL;
  id: string;
  dispatcherInstanceId: string;
  ordinal: number;
  origin: Origin;
  copyIntentId: string;
  copyIntentDefinitionHash: string;
  kind: ItemArchiveCopyIntent['kind'];
  binding: ItemArchiveCopyIntent['binding'];
  previous?: Previous;
  definitionHash: string;
  reservation: 'OBSERVED_ONLY';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export type ItemCopyAttemptInput = Readonly<{
  attemptId: string;
  dispatcherInstanceId: string;
  origin: Origin;
  /** Declared references only. The future store must reread the actual authorized row. */
  previous?: Readonly<{
    attempt: ItemCopyAttemptIntent;
    authorization: Previous;
  }>;
}>;
const fail = (): never => {
  throw new ConflictError(
    'Item copy attempt identity or predecessor is inconsistent',
  );
};
function keys(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const names = Object.keys(value);
  return (
    required.every((k) => names.includes(k)) &&
    names.every((k) => [...required, ...optional].includes(k))
  );
}
function uuid(value: string) {
  if (
    typeof value !== 'string' ||
    !isUuid(value) ||
    value !== value.toLowerCase()
  )
    fail();
  return value;
}
function digest(value: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}
function previousRef(raw: Previous): Previous {
  if (!keys(raw, ['attemptId', 'attemptDefinitionHash', 'authorizationId']))
    fail();
  const ref = Object.freeze({
    attemptId: uuid(raw.attemptId),
    attemptDefinitionHash: digest(raw.attemptDefinitionHash),
    authorizationId: uuid(raw.authorizationId),
  });
  if (ref.attemptId === ref.authorizationId) fail();
  return ref;
}
function finish(
  intent: ItemArchiveCopyIntent,
  id: string,
  dispatcherInstanceId: string,
  ordinal: number,
  origin: Origin,
  previous?: Previous,
): ItemCopyAttemptIntent {
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    (ordinal === 1
      ? origin !== 'INITIAL' || previous !== undefined
      : !['APPLICATION_RETRY', 'SDK_RETRY'].includes(origin) ||
        previous === undefined)
  )
    fail();
  if (
    previous &&
    (previous.attemptId === id || previous.authorizationId === id)
  )
    fail();
  const definition = {
    protocol: ITEM_COPY_ATTEMPT_PROTOCOL,
    id: uuid(id),
    dispatcherInstanceId: uuid(dispatcherInstanceId),
    ordinal,
    origin,
    copyIntentId: intent.id,
    copyIntentDefinitionHash: intent.definitionHash,
    kind: intent.kind,
    binding: intent.binding,
    ...(previous === undefined ? {} : { previous }),
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
function capturePrevious(
  intent: ItemArchiveCopyIntent,
  raw: ItemCopyAttemptIntent,
) {
  if (
    !keys(
      raw,
      [
        'protocol',
        'id',
        'dispatcherInstanceId',
        'ordinal',
        'origin',
        'copyIntentId',
        'copyIntentDefinitionHash',
        'kind',
        'binding',
        'definitionHash',
        'reservation',
        'stableCut',
        'retention',
        'copyDispatch',
        'businessCommit',
      ],
      ['previous'],
    )
  )
    fail();
  const previous =
    raw.previous === undefined ? undefined : previousRef(raw.previous);
  const expected = finish(
    intent,
    raw.id,
    raw.dispatcherInstanceId,
    raw.ordinal,
    raw.origin,
    previous,
  );
  if (archiveHash(raw) !== archiveHash(expected)) fail();
  return expected;
}

/** Reuses original logical definitions; validates data, not DB membership or remote evidence. */
export function buildItemCopyAttemptIntent(
  context: ItemCopyIntentContext,
  kind: ItemArchiveCopyIntent['kind'],
  raw: ItemCopyAttemptInput,
): ItemCopyAttemptIntent {
  if (!keys(raw, ['attemptId', 'dispatcherInstanceId', 'origin'], ['previous']))
    fail();
  const id = uuid(raw.attemptId),
    dispatcher = uuid(raw.dispatcherInstanceId);
  if (!['HISTORICAL', 'RECIPIENT_STAGING'].includes(kind)) fail();
  const historical = buildItemHistoricalCopyIntent(context);
  if (
    context.file.historicalCopyIntent === undefined ||
    archiveHash(context.file.historicalCopyIntent) !== archiveHash(historical)
  )
    fail();
  const intent =
    kind === 'HISTORICAL' ? historical : persistedItemStagingIntent(context);
  if (intent.predecessor?.historicalPutVersion) fail();
  if (raw.origin === 'INITIAL') {
    if (raw.previous !== undefined) fail();
    return finish(intent, id, dispatcher, 1, raw.origin);
  }
  if (
    !['APPLICATION_RETRY', 'SDK_RETRY'].includes(raw.origin) ||
    !keys(raw.previous, ['attempt', 'authorization'])
  )
    fail();
  const prior = capturePrevious(intent, raw.previous!.attempt);
  const authorization = previousRef(raw.previous!.authorization);
  if (
    authorization.attemptId !== prior.id ||
    authorization.attemptDefinitionHash !== prior.definitionHash ||
    prior.ordinal >= Number.MAX_SAFE_INTEGER
  )
    fail();
  return finish(
    intent,
    id,
    dispatcher,
    prior.ordinal + 1,
    raw.origin,
    authorization,
  );
}
