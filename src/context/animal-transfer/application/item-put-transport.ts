import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemPutTransport,
  ItemPutTransportRequest,
  ItemPutTransportReturn,
} from '../domain/transfer-item-historical-put-transport';

/** Preparation verifies the wire projection. The caller must obtain a fresh commit before delegating. */
export async function prepareItemPutTransport(
  transport: ItemPutTransport,
  definition: Omit<ItemPutTransportRequest, 'method'>,
  invalid: () => ConflictError,
  options?: Readonly<{ correlateAudit: true }>,
) {
  const request: ItemPutTransportRequest = Object.freeze({
    ...definition,
    method: 'PUT',
  });
  const prepared = options
    ? await transport.prepare(request, options)
    : await transport.prepare(request);
  if (!prepared) throw invalid();
  const { serializedRequestHash, auditMarkerHash } = prepared;
  if (
    !isDeepStrictEqual(prepared.request, request) ||
    !sourceHashValid(serializedRequestHash) ||
    (options
      ? !sourceHashValid(auditMarkerHash)
      : auditMarkerHash !== undefined) ||
    typeof prepared.sendOnce !== 'function'
  )
    throw invalid();
  const sendOnce = prepared.sendOnce.bind(prepared);
  return Object.freeze({
    transportRequestHash: archiveHash({
      request,
      serializedRequestHash,
      auditMarkerHash,
    }),
    ...(auditMarkerHash === undefined ? {} : { auditMarkerHash }),
    async delegate(
      body: AsyncIterable<Uint8Array>,
    ): Promise<ItemPutTransportReturn> {
      try {
        await sendOnce(body);
        return 'RETURNED';
      } catch {
        return 'THREW';
      }
    },
  });
}
