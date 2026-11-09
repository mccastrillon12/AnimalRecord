import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';
import type { ItemHistoricalPutPermission } from './transfer-item-historical-put-permission';

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
  if (localReturn !== 'RETURNED' && localReturn !== 'THREW')
    throw new ConflictError(
      'The local historical PUT transport result is invalid',
    );
  const facts = {
    protocol: 'ITEM_HISTORICAL_PUT_TRANSPORT_OBSERVATION_V1' as const,
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
