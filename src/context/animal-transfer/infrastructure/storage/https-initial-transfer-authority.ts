import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import type { ItemHistoricalPutDestinationAccreditationReader } from '../../domain/transfer-item-historical-put-destination-protection';
import type { InitialPutEvidenceInputs } from './initial-item-put-preparation';

type Authority = InitialPutEvidenceInputs &
  ItemHistoricalPutDestinationAccreditationReader;
export type TransferAuthorityEndpoint = Readonly<{
  url: string;
  token: string;
  timeoutMs: number;
  maxBytes: number;
}>;

/** Reads authority decisions over authenticated HTTPS. Scope and persisted fences are checked by the existing consumers. */
export function createHttpsInitialTransferAuthority(
  config: TransferAuthorityEndpoint,
  send: typeof fetch = fetch,
): Authority {
  const url = new URL(config.url);
  const { token, timeoutMs, maxBytes } = config;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    typeof token !== 'string' ||
    !/^[\x21-\x7e]{1,4096}$/.test(token) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 4 * 1024 * 1024
  )
    throw new ConflictError(
      'The transfer authority endpoint is not configured',
    );
  const endpoint = url.toString();

  async function query<K extends keyof Authority>(
    operation: K,
    ...input: Parameters<Authority[K]>
  ): Promise<Awaited<ReturnType<Authority[K]>> | null> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await send(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        redirect: 'error',
        signal,
        body: JSON.stringify({
          protocol: 'INITIAL_TRANSFER_AUTHORITY_V1',
          operation,
          input,
        }),
      });
      if (response.status === 204) return null;
      if (
        response.status !== 200 ||
        !response.body ||
        response.headers.get('content-type')?.split(';')[0].trim() !==
          'application/json'
      ) {
        await response.body?.cancel();
        throw new Error();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const envelope: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        !('result' in envelope) ||
        Object.keys(envelope).length !== 1 ||
        envelope.result == null ||
        (operation === 'requiredThrough'
          ? typeof envelope.result !== 'string'
          : typeof envelope.result !== 'object' ||
            Array.isArray(envelope.result))
      )
        throw new Error();
      return envelope.result as Awaited<ReturnType<Authority[K]>>;
    } catch {
      throw new ExternalServiceError(
        'The transfer authority response could not be confirmed',
      );
    }
  }
  return {
    requiredThrough: (input) => query('requiredThrough', input),
    source: (input) => query('source', input),
    historicalDestination: (attempt, horizon) =>
      query('historicalDestination', attempt, horizon),
    stagingDestination: (attempt, horizon) =>
      query('stagingDestination', attempt, horizon),
    finalDestination: (attempt, horizon) =>
      query('finalDestination', attempt, horizon),
    readDestinationAccreditation: (scope, hash) =>
      query('readDestinationAccreditation', scope, hash),
  };
}
