import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';

export type ItemHistoricalPutTransportRequest = Readonly<
  ItemHistoricalPutAttemptV2['request'] & { method: 'PUT' }
>;

/** Trusted adapter. Preparation must never send. The bound request permits one physical delegation. */
export interface ItemHistoricalPutTransport {
  prepare(request: ItemHistoricalPutTransportRequest): Promise<
    Readonly<{
      request: ItemHistoricalPutTransportRequest;
      serializedRequestHash: string;
      /** No retry, redirect, substitution or access to another body. */
      sendOnce(body: AsyncIterable<Uint8Array>): Promise<unknown>;
    }>
  >;
}
