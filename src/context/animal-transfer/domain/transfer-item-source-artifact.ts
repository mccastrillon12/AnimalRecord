import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import { sourceHashValid } from './transfer-item-historical-observation';

export type ItemSourceArtifactIdentity = Readonly<{
  id: string;
  generation: string;
}>;

type ItemSourceArtifactFacts = ItemSourceArtifactIdentity &
  Readonly<{
    anchorHash: string;
    selectorHash: string;
    profileDefinitionHash: string;
    profileObservationHash: string;
    expectedBucketOwner: string;
    observedAt: string;
    fixedRetainUntil: string;
    size: number;
    sha256: string;
  }>;

const invalid = () =>
  new ConflictError('The sealed source artifact is inconsistent');

export function captureItemSourceArtifactIdentity(
  raw: ItemSourceArtifactIdentity,
) {
  const { id, generation } = raw ?? {};
  const token = (value: unknown) =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[^a-zA-Z0-9_-]/.test(value);
  if (!token(id) || !token(generation)) throw invalid();
  return Object.freeze({ id, generation });
}

export function buildItemSourceArtifactSeal(raw: ItemSourceArtifactFacts) {
  const {
    anchorHash,
    selectorHash,
    profileDefinitionHash,
    profileObservationHash,
    expectedBucketOwner,
    observedAt,
    fixedRetainUntil,
    size,
    sha256,
  } = raw;
  const date = (value: string) => {
    const millis = Date.parse(value);
    return Number.isFinite(millis) && new Date(millis).toISOString() === value
      ? millis
      : NaN;
  };
  if (
    ![
      anchorHash,
      selectorHash,
      profileDefinitionHash,
      profileObservationHash,
      sha256,
    ].every(sourceHashValid) ||
    typeof expectedBucketOwner !== 'string' ||
    !/^\d{12}$/.test(expectedBucketOwner) ||
    !(date(observedAt) < date(fixedRetainUntil)) ||
    !Number.isSafeInteger(size) ||
    size < 1
  )
    throw invalid();
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_ARTIFACT_V1' as const,
    ...captureItemSourceArtifactIdentity(raw),
    anchorHash,
    selectorHash,
    profileDefinitionHash,
    profileObservationHash,
    expectedBucketOwner,
    observedAt,
    fixedRetainUntil,
    size,
    sha256,
    reservation: 'OBSERVED_ONLY' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    artifactHash: archiveHash(definition),
  });
}

export type ItemSourceArtifactSeal = ReturnType<
  typeof buildItemSourceArtifactSeal
>;

export function captureItemSourceArtifactSeal(raw: ItemSourceArtifactSeal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const seal = buildItemSourceArtifactSeal(raw);
  if (
    Object.keys(raw).length !== Object.keys(seal).length ||
    Object.entries(seal).some(
      ([key, value]) =>
        !Object.prototype.hasOwnProperty.call(raw, key) ||
        raw[key as keyof typeof raw] !== value,
    )
  )
    throw invalid();
  return seal;
}

/** Single-use private draft with a fresh identity. Seal fixes bytes and metadata together. */
export interface ItemSourceArtifactDraft {
  readonly identity: ItemSourceArtifactIdentity;
  write(bytes: Uint8Array): Promise<void>;
  seal(receipt: ItemSourceArtifactSeal): Promise<void>;
  /** Affects only this generation while still unsealed. */
  discard(): Promise<void>;
}

export type OpenItemSourceArtifact = Readonly<{
  seal: ItemSourceArtifactSeal;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}>;

/** A trusted custodian opens the exact generation with its sealed metadata, without fallback. */
export interface ItemSourceArtifactReader {
  open(
    identity: ItemSourceArtifactIdentity,
  ): Promise<OpenItemSourceArtifact | null>;
}
