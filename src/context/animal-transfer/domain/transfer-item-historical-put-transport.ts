import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';
import type { ItemHistoricalPutPermission } from './transfer-item-historical-put-permission';
import type { ItemStagingPutPermission } from './transfer-item-staging-put-permission';
import type { ItemRecipientFinalPutPermission } from './transfer-item-recipient-final-put-permission';

export type ItemPutTransportRequest = Readonly<
  ItemHistoricalPutAttemptV2['request'] & { method: 'PUT' }
>;

/** Trusted adapter. Preparation must never send. The bound request permits one physical delegation. */
export interface ItemPutTransport {
  prepare(request: ItemPutTransportRequest): Promise<
    Readonly<{
      request: ItemPutTransportRequest;
      serializedRequestHash: string;
      /** No retry, redirect, substitution or access to another body. */
      sendOnce(body: AsyncIterable<Uint8Array>): Promise<unknown>;
    }>
  >;
}

export type ItemHistoricalPutTransport = ItemPutTransport;
export type ItemHistoricalPutTransportRequest = ItemPutTransportRequest;
export type ItemPutTransportReturn = 'RETURNED' | 'THREW';
export type ItemHistoricalPutTransportReturn = ItemPutTransportReturn;

/** Evidence of local control flow for one exact, already recorded permission. */
export function buildHistoricalPutTransportObservation(
  permission: ItemHistoricalPutPermission,
  localReturn: ItemHistoricalPutTransportReturn,
) {
  return buildPutTransportObservation(
    permission,
    localReturn,
    'ITEM_HISTORICAL_PUT_TRANSPORT_OBSERVATION_V1',
    'The local historical PUT transport result is invalid',
  );
}

export function buildStagingPutTransportObservation(
  permission: ItemStagingPutPermission,
  localReturn: ItemPutTransportReturn,
) {
  return buildPutTransportObservation(
    permission,
    localReturn,
    'ITEM_STAGING_PUT_TRANSPORT_OBSERVATION_V1',
    'The local staging PUT transport result is invalid',
  );
}

export function buildRecipientFinalPutTransportObservation(
  permission: ItemRecipientFinalPutPermission,
  localReturn: ItemPutTransportReturn,
) {
  return buildPutTransportObservation(
    permission,
    localReturn,
    'ITEM_RECIPIENT_FINAL_PUT_TRANSPORT_OBSERVATION_V1',
    'The local recipient final PUT transport result is invalid',
  );
}

function buildPutTransportObservation<Protocol extends string>(
  permission: Pick<
    ItemHistoricalPutPermission,
    'authorizationId' | 'permissionHash'
  >,
  localReturn: ItemPutTransportReturn,
  protocol: Protocol,
  invalidMessage: string,
) {
  if (localReturn !== 'RETURNED' && localReturn !== 'THREW')
    throw new ConflictError(invalidMessage);
  const facts = {
    protocol,
    authorizationId: permission.authorizationId,
    permissionHash: permission.permissionHash,
    localReturn,
    outcome: 'UNKNOWN' as const,
  };
  return Object.freeze({ ...facts, observationHash: archiveHash(facts) });
}

export type ItemHistoricalPutTransportObservation = ReturnType<
  typeof buildHistoricalPutTransportObservation
>;
export type ItemStagingPutTransportObservation = ReturnType<
  typeof buildStagingPutTransportObservation
>;
export type ItemRecipientFinalPutTransportObservation = ReturnType<
  typeof buildRecipientFinalPutTransportObservation
>;

export function matchHistoricalPutTransportObservation(
  permission: ItemHistoricalPutPermission,
  stored: ItemHistoricalPutTransportObservation,
) {
  const expected = buildHistoricalPutTransportObservation(
    permission,
    stored?.localReturn,
  );
  if (!isDeepStrictEqual(stored, expected))
    throw new ConflictError(
      'The stored historical PUT transport observation is inconsistent',
    );
  return expected;
}

export function matchStagingPutTransportObservation(
  permission: ItemStagingPutPermission,
  stored: ItemStagingPutTransportObservation,
) {
  const expected = buildStagingPutTransportObservation(
    permission,
    stored?.localReturn,
  );
  if (!isDeepStrictEqual(stored, expected))
    throw new ConflictError(
      'The stored staging PUT transport observation is inconsistent',
    );
  return expected;
}

export function matchRecipientFinalPutTransportObservation(
  permission: ItemRecipientFinalPutPermission,
  stored: ItemRecipientFinalPutTransportObservation,
) {
  const expected = buildRecipientFinalPutTransportObservation(
    permission,
    stored?.localReturn,
  );
  if (!isDeepStrictEqual(stored, expected))
    throw new ConflictError(
      'The stored recipient final PUT transport observation is inconsistent',
    );
  return expected;
}
