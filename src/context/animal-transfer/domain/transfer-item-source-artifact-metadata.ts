import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { isDeepStrictEqual } from 'node:util';
import { archiveHash } from './ownership-archive';
import {
  ItemSourceArtifactSeal,
  captureItemSourceArtifactSeal,
} from './transfer-item-source-artifact';

export type ItemSourceRepresentation = Readonly<{
  contentType: string;
  contentEncoding?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  cacheControl?: string;
  expires?: string;
}>;

const fields = [
  'contentType',
  'contentEncoding',
  'contentLanguage',
  'contentDisposition',
  'cacheControl',
  'expires',
] as const;
const invalid = () =>
  new ConflictError(
    'The historical source representation metadata is incomplete or invalid',
  );

export function captureItemSourceRepresentation(
  raw: Partial<ItemSourceRepresentation> | undefined,
): ItemSourceRepresentation {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !fields.some((field) => field === key))
  )
    throw invalid();
  const copy: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = raw[field];
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > 1024 ||
      value.trim() !== value ||
      /[^\x20-\x7e]/.test(value)
    )
      throw invalid();
    copy[field] = value;
  }
  const { contentType, expires } = copy;
  const expiration = expires === undefined ? undefined : new Date(expires);
  if (
    !contentType ||
    !/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+\/[a-zA-Z0-9!#$%&'*+.^_`|~-]+(?: *; *[^;].*)?$/.test(
      contentType,
    ) ||
    (expiration &&
      (!Number.isFinite(expiration.getTime()) ||
        expiration.toUTCString() !== expires))
  )
    throw invalid();
  return Object.freeze({ ...copy, contentType });
}

export type ItemSourceArtifactMetadata = ReturnType<
  typeof buildItemSourceArtifactMetadata
>;

export function matchItemSourceArtifactMetadata(
  seal: ItemSourceArtifactSeal,
  raw: ItemSourceArtifactMetadata,
  expectedMetadataHash: string,
) {
  const expected = buildItemSourceArtifactMetadata(seal, raw?.representation);
  if (
    expected.metadataHash !== expectedMetadataHash ||
    !isDeepStrictEqual(raw, expected)
  )
    throw invalid();
  return expected;
}

/** Facts from the same complete GET as the sealed bytes. This is observational. */
export function buildItemSourceArtifactMetadata(
  rawSeal: ItemSourceArtifactSeal,
  raw: Partial<ItemSourceRepresentation> | undefined,
) {
  const { artifactHash } = captureItemSourceArtifactSeal(rawSeal);
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_ARTIFACT_METADATA_V1' as const,
    artifactHash,
    representation: captureItemSourceRepresentation(raw),
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    metadataHash: archiveHash(definition),
  });
}
