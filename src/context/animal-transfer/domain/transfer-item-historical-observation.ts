import { validate as isUuid } from 'uuid';
import { ObjectRevision, archiveHash } from './ownership-archive';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import type { ItemCopyAttemptIntent } from './transfer-item-copy-attempt';
import {
  ItemArchiveCopyIntent,
  ItemHistoricalCopyObservation,
  ItemCopyIntentContext,
  ItemHistoricalSourceAnchorInput,
  ItemHistoricalSourceAnchorMaterial,
  buildItemHistoricalSourceAnchor,
  buildItemHistoricalCopyIntent,
  buildItemStagingCopyIntent,
  captureItemObjectRevision,
  historicalSourceAnchorInput,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';

export type HistoricalReadTarget = Readonly<{
  bucket: string;
  key: string;
}>;
export type ItemSourceRetentionTarget = HistoricalReadTarget &
  Readonly<{ versionId: string }>;
export interface ItemSourceRetentionReader {
  readSourceRetention(target: ItemSourceRetentionTarget): Promise<
    Readonly<{
      expectedBucketOwner: string;
      mode: 'COMPLIANCE';
      reportedRetainUntil: string;
    }>
  >;
}
export type ItemSourceRetentionPreparationInput = Readonly<{
  anchor: ItemHistoricalSourceAnchorInput;
  expectedBucketOwner: string;
}>;
type SourceRetentionFacts = Readonly<{
  anchorHash: string;
  selectorHash: string;
  mode: 'COMPLIANCE';
  observedAt: string;
  reportedRetainUntil: string;
}>;
export type ItemSourceRetentionObservation = ReturnType<
  typeof buildItemSourceRetentionObservation
>;
export type ItemSourceRetentionReceipt = Readonly<{
  observation: ItemSourceRetentionObservation;
  replayed: boolean;
}>;

const invalidRetention = () =>
  new ConflictError('Source retention observation identity is inconsistent');
function validBucketOwner(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 12 &&
    /^[0-9]{12}$/.test(value)
  );
}
export function sourceRetentionPreparationInput(
  raw: ItemSourceRetentionPreparationInput,
): ItemSourceRetentionPreparationInput {
  if (
    !keys(raw, ['anchor', 'expectedBucketOwner']) ||
    !validBucketOwner(raw.expectedBucketOwner)
  )
    throw new InvalidArgumentError(
      'Invalid source retention preparation input',
    );
  return Object.freeze({
    anchor: historicalSourceAnchorInput(raw.anchor),
    expectedBucketOwner: raw.expectedBucketOwner,
  });
}
export function sourceRetentionSelectorHash(
  source: ItemHistoricalSourceAnchorMaterial['source'],
  expectedBucketOwner: string,
) {
  const {
    bucket,
    key,
    revision: { versionId },
  } = source;
  if (
    !validBucketOwner(expectedBucketOwner) ||
    !isPinnedItemSourceVersion(versionId)
  )
    throw invalidRetention();
  return archiveHash({ bucket, key, versionId, expectedBucketOwner });
}
function canonicalMillis(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value
    ? millis
    : NaN;
}
export function sourceHashValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 64 &&
    /^[a-f0-9]{64}$/.test(value)
  );
}
function sourceRetentionObservationFields(raw: SourceRetentionFacts) {
  const { anchorHash, selectorHash, mode, observedAt, reportedRetainUntil } =
    raw;
  if (
    mode !== 'COMPLIANCE' ||
    ![anchorHash, selectorHash].every(sourceHashValid) ||
    !(canonicalMillis(reportedRetainUntil) > canonicalMillis(observedAt))
  )
    throw invalidRetention();
  return {
    anchorHash,
    selectorHash,
    mode,
    observedAt,
    reportedRetainUntil,
    reservation: 'OBSERVED_ONLY' as const,
    provenance: 'NOT_ASSESSED' as const,
    readability: 'NOT_ASSESSED' as const,
    coverage: 'NOT_ASSESSED' as const,
    stableCut: 'NOT_ASSESSED' as const,
    retention: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
}
export function buildItemSourceRetentionObservation(raw: SourceRetentionFacts) {
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_RETENTION_OBSERVATION_V1' as const,
    ...sourceRetentionObservationFields(raw),
  };
  return Object.freeze({
    ...definition,
    observationHash: archiveHash(definition),
  });
}
export function buildItemFixedSourceObservation(
  raw: Omit<SourceRetentionFacts, 'reportedRetainUntil'> &
    Readonly<{ eventHold: 'OFF'; fixedRetainUntil: string }>,
) {
  if (raw.eventHold !== 'OFF') throw invalidRetention();
  const { reportedRetainUntil: fixedRetainUntil, ...fields } =
    sourceRetentionObservationFields({
      ...raw,
      reportedRetainUntil: raw.fixedRetainUntil,
    });
  const definition = {
    protocol: 'ITEM_HISTORICAL_FIXED_SOURCE_OBSERVATION_V1' as const,
    ...fields,
    eventHold: raw.eventHold,
    fixedRetainUntil,
    bytes: 'MATCH' as const,
  };
  return Object.freeze({
    ...definition,
    observationHash: archiveHash(definition),
  });
}
export type ItemFixedSourceStorage = Readonly<{
  encryption: 'SSE_S3' | 'SSE_KMS' | 'SSE_C' | 'UNKNOWN';
  storageClass: 'STANDARD' | 'OMITTED' | 'OTHER';
  restoreOrArchiveReported: boolean;
}>;
export function buildItemSourceStorageObservation(
  fixedSourceObservationHash: string,
  {
    encryption,
    storageClass,
    restoreOrArchiveReported,
  }: ItemFixedSourceStorage,
) {
  if (
    !['SSE_S3', 'SSE_KMS', 'SSE_C', 'UNKNOWN'].includes(encryption) ||
    !['STANDARD', 'OMITTED', 'OTHER'].includes(storageClass) ||
    typeof restoreOrArchiveReported !== 'boolean'
  )
    throw new ConflictError(
      'The fixed source storage metadata is inconsistent',
    );
  const candidate =
    encryption === 'SSE_S3' &&
    storageClass !== 'OTHER' &&
    !restoreOrArchiveReported;
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_STORAGE_OBSERVATION_V1' as const,
    fixedSourceObservationHash,
    encryption,
    storageClass,
    restoreOrArchiveReported,
    classification: candidate
      ? storageClass === 'STANDARD'
        ? ('MATCHES_CANDIDATE_METADATA' as const)
        : ('STANDARD_IF_DIRECT_S3' as const)
      : ('OUTSIDE_CANDIDATE' as const),
    reservation: 'OBSERVED_ONLY' as const,
    readability: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    observationHash: archiveHash(definition),
  });
}
export type ItemSourceProfileReference = Readonly<{
  id: string;
  revision: number;
  definitionHash: string;
}>;
export type ItemSourceProfileRecord = ItemSourceProfileReference &
  Readonly<{
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1';
    state: 'ACTIVE' | 'INVALIDATED';
    issuerId: string;
    selectorHash: string;
    signerContextHash: string;
    controlsHash: string;
    validFrom: string;
    validUntil: string;
  }>;
export type ItemSourceProfileObservationInput = Readonly<{
  anchor: ItemHistoricalSourceAnchorInput;
  expectedProfile: ItemSourceProfileReference;
}>;
export type ItemSourceProfilePreparationInput =
  ItemSourceProfileObservationInput & ItemSourceRetentionPreparationInput;
export type ItemSourceProfileObservationReceipt = Readonly<{
  observation: ItemSourceProfileObservationSet;
  replayed: boolean;
}>;
export type ItemSourceProfileObservationSet = Readonly<{
  fixedSource: ReturnType<typeof buildItemFixedSourceObservation>;
  storageObservation: ReturnType<typeof buildItemSourceStorageObservation>;
  profileObservation: ReturnType<typeof buildItemSourceProfileObservation>;
}>;
/** Trusted internal reader of the current row for an ID, including invalidation. */
export interface ItemSourceProfileReader {
  readCurrentSourceProfile(id: string): Promise<ItemSourceProfileRecord | null>;
}
const invalidProfile = () =>
  new ConflictError(
    'The original source profile is unavailable, changed or invalid',
  );
export function profileIdValid(value: unknown): value is string {
  return (
    typeof value === 'string' && isUuid(value) && value === value.toLowerCase()
  );
}
export function itemSourceProfileObservationInput(
  raw: ItemSourceProfileObservationInput,
): ItemSourceProfileObservationInput {
  if (!keys(raw, ['anchor', 'expectedProfile'])) throw invalidProfile();
  return Object.freeze({
    anchor: historicalSourceAnchorInput(raw.anchor),
    expectedProfile: captureItemSourceProfileReference(raw.expectedProfile),
  });
}
export function sourceProfilePreparationInput(
  raw: ItemSourceProfilePreparationInput,
): ItemSourceProfilePreparationInput {
  if (!keys(raw, ['anchor', 'expectedBucketOwner', 'expectedProfile']))
    throw invalidProfile();
  return Object.freeze({
    ...sourceRetentionPreparationInput({
      anchor: raw.anchor,
      expectedBucketOwner: raw.expectedBucketOwner,
    }),
    expectedProfile: captureItemSourceProfileReference(raw.expectedProfile),
  });
}
export function captureItemSourceProfileReference(
  reference: ItemSourceProfileReference,
): ItemSourceProfileReference {
  if (
    !keys(reference, ['id', 'revision', 'definitionHash']) ||
    !profileIdValid(reference.id) ||
    !Number.isSafeInteger(reference.revision) ||
    reference.revision < 0 ||
    !sourceHashValid(reference.definitionHash)
  )
    throw invalidProfile();
  return Object.freeze({ ...reference });
}
export function captureItemSourceProfileRecord(
  raw: ItemSourceProfileRecord | null,
): ItemSourceProfileRecord {
  if (
    !raw ||
    !keys(raw, [
      'protocol',
      'id',
      'revision',
      'definitionHash',
      'state',
      'issuerId',
      'selectorHash',
      'signerContextHash',
      'controlsHash',
      'validFrom',
      'validUntil',
    ]) ||
    raw.protocol !== 'ITEM_HISTORICAL_SOURCE_PROFILE_V1' ||
    !['ACTIVE', 'INVALIDATED'].includes(raw.state) ||
    !profileIdValid(raw.issuerId) ||
    ![raw.selectorHash, raw.signerContextHash, raw.controlsHash].every(
      sourceHashValid,
    ) ||
    !(canonicalMillis(raw.validFrom) < canonicalMillis(raw.validUntil))
  )
    throw invalidProfile();
  captureItemSourceProfileReference({
    id: raw.id,
    revision: raw.revision,
    definitionHash: raw.definitionHash,
  });
  const { state, definitionHash, ...definition } = raw;
  if (archiveHash(definition) !== definitionHash) throw invalidProfile();
  return Object.freeze({ ...definition, definitionHash, state });
}
export function matchActiveItemSourceProfile(
  raw: ItemSourceProfileRecord | null,
  expected: ItemSourceProfileReference,
): ItemSourceProfileRecord {
  const profile = captureItemSourceProfileRecord(raw);
  if (
    profile.state !== 'ACTIVE' ||
    profile.id !== expected.id ||
    profile.revision !== expected.revision ||
    profile.definitionHash !== expected.definitionHash
  )
    throw invalidProfile();
  return profile;
}
export function assertItemSourceProfileWindow(
  profile: ItemSourceProfileRecord,
  at: number,
): void {
  if (
    !(
      at >= canonicalMillis(profile.validFrom) &&
      at < canonicalMillis(profile.validUntil)
    )
  )
    throw new ConflictError(
      'The original source profile revision is outside its observation window',
    );
}

export function buildItemSourceProfileObservation(
  profile: ItemSourceProfileReference,
  fixedSource: ItemSourceProfileObservationSet['fixedSource'],
  storage: ItemSourceProfileObservationSet['storageObservation'],
) {
  if (
    storage.classification === 'OUTSIDE_CANDIDATE' ||
    storage.fixedSourceObservationHash !== fixedSource.observationHash
  )
    throw new ConflictError(
      'The original source is outside the storage profile candidate',
    );
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_OBSERVATION_V1' as const,
    profile: captureItemSourceProfileReference(profile),
    fixedSourceObservationHash: fixedSource.observationHash,
    storageObservationHash: storage.observationHash,
    reservation: 'OBSERVED_ONLY' as const,
    readability: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    observationHash: archiveHash(definition),
  });
}

/** Capture the canonical V1 set before asynchronous work. */
export function captureItemSourceProfileObservationSet(
  raw: ItemSourceProfileObservationSet,
): ItemSourceProfileObservationSet {
  const invalid = () =>
    new ConflictError('Source profile observation set is inconsistent');
  if (
    !keys(raw, ['fixedSource', 'storageObservation', 'profileObservation']) ||
    !raw.fixedSource ||
    !raw.storageObservation ||
    !raw.profileObservation
  )
    throw invalid();

  const fixedSource = buildItemFixedSourceObservation({
    anchorHash: raw.fixedSource.anchorHash,
    selectorHash: raw.fixedSource.selectorHash,
    mode: raw.fixedSource.mode,
    eventHold: raw.fixedSource.eventHold,
    observedAt: raw.fixedSource.observedAt,
    fixedRetainUntil: raw.fixedSource.fixedRetainUntil,
  });
  const storageObservation = buildItemSourceStorageObservation(
    fixedSource.observationHash,
    raw.storageObservation,
  );
  const profileObservation = buildItemSourceProfileObservation(
    raw.profileObservation.profile,
    fixedSource,
    storageObservation,
  );
  const ref = raw.profileObservation.profile;
  if (
    !sameFields(raw.fixedSource, fixedSource) ||
    !sameFields(raw.storageObservation, storageObservation) ||
    !sameFields(ref, profileObservation.profile) ||
    !sameFields(raw.profileObservation, { ...profileObservation, profile: ref })
  )
    throw invalid();

  return Object.freeze({ fixedSource, storageObservation, profileObservation });
}

/** Rebuild and bind the three V1 observations to the persisted anchor and pins. */
export function matchItemSourceProfileObservationSet(
  raw: ItemSourceProfileObservationSet,
  material: ItemHistoricalSourceAnchorMaterial,
  expectedBucketOwner: string,
  expectedProfile: ItemSourceProfileReference,
): ItemSourceProfileObservationSet {
  const set = captureItemSourceProfileObservationSet(raw);
  if (
    set.fixedSource.anchorHash !==
      buildItemHistoricalSourceAnchor(material).anchorHash ||
    set.fixedSource.selectorHash !==
      sourceRetentionSelectorHash(material.source, expectedBucketOwner) ||
    !sameFields(
      set.profileObservation.profile,
      captureItemSourceProfileReference(expectedProfile),
    )
  )
    throw new ConflictError('Source profile observation set is inconsistent');
  return set;
}

function sameFields(
  actual: unknown,
  expected: Readonly<Record<string, unknown>>,
) {
  return (
    keys(actual, Object.keys(expected)) &&
    Object.entries(expected).every(
      ([field, value]) => (actual as Record<string, unknown>)[field] === value,
    )
  );
}

/** These inputs are supplied by internal producers of operational evidence. */
export type ItemSourceOperationalAccreditation = Readonly<{
  profileDefinitionHash: string;
  endpoint: 'DIRECT_S3';
  evidenceHash: string;
  validFrom: string;
  validUntil: string;
}>;

export function captureItemSourceOperationalAccreditation(
  raw: ItemSourceOperationalAccreditation | undefined,
): ItemSourceOperationalAccreditation {
  if (
    !raw ||
    !keys(raw, [
      'profileDefinitionHash',
      'endpoint',
      'evidenceHash',
      'validFrom',
      'validUntil',
    ]) ||
    raw.endpoint !== 'DIRECT_S3' ||
    ![raw.profileDefinitionHash, raw.evidenceHash].every(sourceHashValid) ||
    !(canonicalMillis(raw.validFrom) < canonicalMillis(raw.validUntil))
  )
    throw new ConflictError('The source operational accreditation is invalid');
  return Object.freeze({ ...raw });
}

export function matchItemSourceOperationalAccreditation(
  raw: ItemSourceOperationalAccreditation,
  profile: ItemSourceProfileRecord,
): ItemSourceOperationalAccreditation {
  const accreditation = captureItemSourceOperationalAccreditation(raw);
  if (
    profile.state !== 'ACTIVE' ||
    accreditation.profileDefinitionHash !== profile.definitionHash ||
    canonicalMillis(accreditation.validFrom) >=
      canonicalMillis(profile.validUntil) ||
    canonicalMillis(accreditation.validUntil) <=
      canonicalMillis(profile.validFrom)
  )
    throw new ConflictError(
      'The source operational accreditation does not match the active profile',
    );
  return accreditation;
}
type ItemSourceLastReadBound = Readonly<{
  basis: 'ACCREDITED_LAST_SOURCE_READ';
  attemptDefinitionHash: string;
  signerContextHash: string;
  evidenceHash: string;
  lastReadAt: string;
  marginMs: number;
}>;
type ItemSourceReadWindowInput = Readonly<{
  material: ItemHistoricalSourceAnchorMaterial;
  expectedBucketOwner: string;
  observation: ItemSourceProfileObservationSet;
  currentProfile: ItemSourceProfileRecord | null;
  attempt: ItemCopyAttemptIntent;
  accreditation?: ItemSourceOperationalAccreditation;
  readBound?: ItemSourceLastReadBound;
  evaluatedAt: string;
}>;

/** Pure evaluation. A future caller must reread and fence all inputs in its transaction. */
export function evaluateItemSourceReadWindow(input: ItemSourceReadWindowInput) {
  const { material, attempt, readBound, evaluatedAt } = input;
  const invalid = () =>
    new ConflictError('The original source read window is not established');
  if (
    !keys(readBound, [
      'basis',
      'attemptDefinitionHash',
      'signerContextHash',
      'evidenceHash',
      'lastReadAt',
      'marginMs',
    ]) ||
    !readBound ||
    readBound.basis !== 'ACCREDITED_LAST_SOURCE_READ' ||
    !sourceHashValid(readBound.evidenceHash) ||
    !Number.isSafeInteger(readBound.marginMs) ||
    readBound.marginMs <= 0
  )
    throw invalid();

  const current = captureItemSourceProfileRecord(input.currentProfile);
  if (!input.accreditation) throw invalid();
  const accreditation = matchItemSourceOperationalAccreditation(
    input.accreditation,
    current,
  );
  const set = matchItemSourceProfileObservationSet(
    input.observation,
    material,
    input.expectedBucketOwner,
    {
      id: current.id,
      revision: current.revision,
      definitionHash: current.definitionHash,
    },
  );
  if (!attempt) throw invalid();
  const { definitionHash: attemptHash, ...attemptDefinition } = attempt;
  if (
    current.selectorHash !== set.fixedSource.selectorHash ||
    attempt.protocol !== 'ITEM_COPY_ATTEMPT_INTENT_V1' ||
    attempt.kind !== 'HISTORICAL' ||
    attempt.copyIntentId !== material.intentId ||
    attempt.copyIntentDefinitionHash !== material.intentDefinitionHash ||
    archiveHash(attempt.binding) !== archiveHash(material.binding) ||
    !sourceHashValid(attemptHash) ||
    archiveHash(attemptDefinition) !== attemptHash ||
    readBound.attemptDefinitionHash !== attemptHash ||
    readBound.signerContextHash !== current.signerContextHash
  )
    throw invalid();

  const checkedAt = canonicalMillis(evaluatedAt);
  const observedAt = canonicalMillis(set.fixedSource.observedAt);
  const lastReadAt = canonicalMillis(readBound.lastReadAt);
  const limit = Math.min(
    canonicalMillis(set.fixedSource.fixedRetainUntil),
    canonicalMillis(current.validUntil),
    canonicalMillis(accreditation.validUntil),
  );
  assertItemSourceProfileWindow(current, observedAt);
  assertItemSourceProfileWindow(current, checkedAt);
  if (
    !(
      checkedAt >= observedAt &&
      checkedAt >= canonicalMillis(accreditation.validFrom) &&
      lastReadAt > checkedAt &&
      lastReadAt < limit
    ) ||
    BigInt(lastReadAt) + BigInt(readBound.marginMs) >= BigInt(limit)
  )
    throw invalid();

  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_READ_WINDOW_V1' as const,
    assessment: 'WINDOW_FITS' as const,
    profileObservationHash: set.profileObservation.observationHash,
    attemptDefinitionHash: attemptHash,
    accreditationEvidenceHash: accreditation.evidenceHash,
    readBoundEvidenceHash: readBound.evidenceHash,
    evaluatedAt,
    lastReadAt: readBound.lastReadAt,
    marginMs: readBound.marginMs,
    limitAt: new Date(limit).toISOString(),
    reservation: 'OBSERVED_ONLY' as const,
    stableCut: 'NOT_ASSESSED' as const,
    retention: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...definition,
    assessmentHash: archiveHash(definition),
  });
}

/** Captures local shape and hash. Only the explicitly composed reader is a producer. */
export function captureItemSourceRetentionObservation(
  raw: ItemSourceRetentionObservation,
): ItemSourceRetentionObservation {
  if (!raw || typeof raw !== 'object') throw invalidRetention();
  const expected = buildItemSourceRetentionObservation(raw);
  if (
    !keys(raw, Object.keys(expected)) ||
    archiveHash(raw) !== archiveHash(expected)
  )
    throw invalidRetention();
  return expected;
}
export function matchItemSourceRetentionObservation(
  raw: ItemSourceRetentionObservation,
  material: ItemHistoricalSourceAnchorMaterial,
  expectedBucketOwner: string,
) {
  const observed = captureItemSourceRetentionObservation(raw);
  if (
    observed.anchorHash !==
      buildItemHistoricalSourceAnchor(material).anchorHash ||
    observed.selectorHash !==
      sourceRetentionSelectorHash(material.source, expectedBucketOwner)
  )
    throw invalidRetention();
  return observed;
}

export type HistoricalReadRevision = {
  etag?: string;
  size?: number;
  versionId?: string;
};
export type HistoricalReadHead = HistoricalReadTarget & HistoricalReadRevision;
export type HistoricalObjectRead = Readonly<{
  revision: HistoricalReadRevision;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}>;
/** Trusted read-only collaborator: binds every request to the target bucket/key. */
export interface ItemHistoricalObjectReader {
  head(target: HistoricalReadTarget): Promise<HistoricalReadHead | null>;
  read(
    target: HistoricalReadTarget,
    revision: Readonly<ObjectRevision>,
  ): Promise<HistoricalObjectRead>;
}
/** Metadata and stream must come from the same complete response. */
export type ItemFixedSourceMetadata = Readonly<{
  expectedBucketOwner: string;
  mode: 'COMPLIANCE';
  eventHold: 'OFF';
  fixedRetainUntil: string;
}>;
export type ItemFixedSourceRead = HistoricalObjectRead &
  ItemFixedSourceMetadata &
  Readonly<{ storage?: ItemFixedSourceStorage }>;
export interface ItemFixedSourceReader {
  readFixedSource(
    target: HistoricalReadTarget,
    revision: Readonly<ObjectRevision>,
  ): Promise<ItemFixedSourceRead>;
}
/** Evidence of reads relative to one definition; never a copy or business permission. */
export type ItemHistoricalByteObservation = Readonly<{
  protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
  binding: ItemArchiveCopyIntent['binding'];
  observation: Readonly<ItemHistoricalCopyObservation>;
  observationHash: string;
  bytes: 'MATCH';
  reservation: 'OBSERVED_ONLY';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
/** Reads of the original manifest revision, distinct from the historical destination.
 * Cannot be consumed as historical verification or as a staging predecessor. */
export type ItemSourceByteObservation = Omit<
  ItemHistoricalByteObservation,
  'protocol'
> &
  Readonly<{
    protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1';
  }>;
/** Destination of the persisted staging intent; never its historical predecessor. */
export type ItemStagingByteObservation = Omit<
  ItemHistoricalByteObservation,
  'protocol'
> &
  Readonly<{ protocol: 'ITEM_STAGING_BYTE_OBSERVATION_V1' }>;

export type ItemStagingCopyPreparationReceipt = Readonly<{
  transferId: string;
  itemId: string;
  fileId: string;
  intentId: string;
  intentDefinitionHash: string;
  observationHash: string;
  replayed: boolean;
  reservation: 'FENCED_AT_PREPARATION';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
/** Same minimal receipt shape; intent identifies the original historical intent. */
export type ItemSourceObservationReceipt = ItemStagingCopyPreparationReceipt;
/** Intent identifies staging; the receipt grants no copy or business capability. */
export type ItemStagingObservationReceipt = ItemStagingCopyPreparationReceipt;

const invalid = () =>
  new ConflictError('Historical byte observation identity is inconsistent');
function keys(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const names = Object.keys(value);
  return (
    required.every((k) => names.includes(k)) &&
    names.every((k) => [...required, ...optional].includes(k))
  );
}
/** Shape/identity capture, not authentication that a trusted collector read bytes. */
export function captureHistoricalByteObservation(
  raw: ItemHistoricalByteObservation,
): ItemHistoricalByteObservation {
  return captureByteObservation(
    raw,
    'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
    invalid,
  );
}
const invalidSource = () =>
  new ConflictError('Source byte observation identity is inconsistent');
export function captureSourceByteObservation(
  raw: ItemSourceByteObservation,
): ItemSourceByteObservation {
  return captureByteObservation(
    raw,
    'ITEM_SOURCE_BYTE_OBSERVATION_V1',
    invalidSource,
  );
}
function captureByteObservation<
  T extends
    | ItemHistoricalByteObservation
    | ItemSourceByteObservation
    | ItemStagingByteObservation,
>(raw: T, protocol: T['protocol'], invalid: () => ConflictError): T {
  if (
    !raw ||
    !keys(raw, [
      'protocol',
      'binding',
      'observation',
      'observationHash',
      'bytes',
      'reservation',
      'provenance',
      'stableCut',
      'retention',
      'copyDispatch',
      'businessCommit',
    ]) ||
    raw.protocol !== protocol ||
    raw.bytes !== 'MATCH' ||
    raw.reservation !== 'OBSERVED_ONLY' ||
    raw.provenance !== 'NOT_ASSESSED' ||
    raw.stableCut !== 'NOT_ASSESSED' ||
    raw.retention !== 'NOT_ASSESSED' ||
    raw.copyDispatch !== 'NOT_AUTHORIZED' ||
    raw.businessCommit !== 'NOT_AUTHORIZED' ||
    !keys(raw.binding, [
      'transferId',
      'itemId',
      'requestVersion',
      'observedSeal',
      'observedSealHash',
      'fileId',
      'fileDefinitionHash',
    ]) ||
    !keys(raw.binding.observedSeal, [
      'acceptanceBindingHash',
      'archiveId',
      'definitionHash',
      'reservationBindingHash',
      'reservationEpoch',
      'captureRevision',
      'expectedEntryCount',
      'expectedFileCount',
    ]) ||
    !keys(raw.observation, [
      'intentId',
      'intentDefinitionHash',
      'bucket',
      'key',
      'revision',
      'sha256',
    ]) ||
    !keys(raw.observation.revision, ['etag', 'size'], ['versionId'])
  )
    throw invalid();
  const primitives = [
    raw.observationHash,
    ...Object.entries(raw.binding)
      .filter(([k]) => k !== 'observedSeal')
      .map(([, v]) => v),
    ...Object.values(raw.binding.observedSeal),
    ...Object.entries(raw.observation)
      .filter(([k]) => k !== 'revision')
      .map(([, v]) => v),
    ...Object.values(raw.observation.revision),
  ];
  if (
    primitives.some(
      (v) =>
        v !== undefined &&
        typeof v !== 'string' &&
        !(typeof v === 'number' && Number.isSafeInteger(v)),
    )
  )
    throw invalid();
  const copy = structuredClone(raw);
  if (copy.observationHash !== archiveHash(copy.observation)) throw invalid();
  Object.freeze(copy.binding.observedSeal);
  Object.freeze(copy.binding);
  Object.freeze(copy.observation.revision);
  Object.freeze(copy.observation);
  return Object.freeze(copy);
}

/** Trust boundary is the collector; identity capture does not authenticate JSON. */
export function matchSourceByteObservation(
  context: ItemCopyIntentContext,
  raw: ItemSourceByteObservation,
): ItemSourceByteObservation {
  const observation = captureSourceByteObservation(raw);
  const intent = buildItemHistoricalCopyIntent(context);
  if (
    context.file.historicalCopyIntent === undefined ||
    archiveHash(context.file.historicalCopyIntent) !== archiveHash(intent) ||
    archiveHash(observation.binding) !== archiveHash(intent.binding) ||
    archiveHash(observation.observation) !==
      archiveHash({
        intentId: intent.id,
        intentDefinitionHash: intent.definitionHash,
        bucket: intent.bucket,
        key: intent.source.key,
        revision: intent.source.revision,
        sha256: intent.source.sha256,
      })
  )
    throw invalidSource();
  return observation;
}

/** Recompute from current persisted context; a self-consistent JSON hash is not permission. */
export function buildStagingCopyPreparation(
  context: ItemCopyIntentContext,
  raw: ItemHistoricalByteObservation,
) {
  const observation = captureHistoricalByteObservation(raw);
  const historical = buildItemHistoricalCopyIntent(context);
  if (
    context.file.historicalCopyIntent === undefined ||
    archiveHash(context.file.historicalCopyIntent) !==
      archiveHash(historical) ||
    archiveHash(observation.binding) !== archiveHash(historical.binding)
  )
    throw invalid();
  const intent = buildItemStagingCopyIntent(
    context,
    historical,
    observation.observation,
  );
  return Object.freeze({ observation, intent });
}

const invalidStaging = () =>
  new ConflictError('Staging byte observation identity is inconsistent');
export function captureStagingByteObservation(
  raw: ItemStagingByteObservation,
): ItemStagingByteObservation {
  return captureByteObservation(
    raw,
    'ITEM_STAGING_BYTE_OBSERVATION_V1',
    invalidStaging,
  );
}
/** Rebuild both persisted predecessors; never create a missing staging intent. */
export function persistedItemStagingIntent(
  context: ItemCopyIntentContext,
): ItemArchiveCopyIntent {
  const pair = buildStagingCopyPreparation(
    context,
    context.file.historicalByteObservation!,
  );
  if (
    context.file.stagingCopyIntent === undefined ||
    archiveHash(context.file.stagingCopyIntent) !== archiveHash(pair.intent) ||
    archiveHash(context.file.historicalByteObservation) !==
      archiveHash(pair.observation)
  )
    throw invalidStaging();
  return pair.intent;
}
export function matchStagingByteObservation(
  context: ItemCopyIntentContext,
  raw: ItemStagingByteObservation,
): ItemStagingByteObservation {
  const observed = captureStagingByteObservation(raw);
  const intent = persistedItemStagingIntent(context);
  const revision = captureItemObjectRevision(observed.observation.revision);
  if (
    archiveHash(observed.binding) !== archiveHash(intent.binding) ||
    revision.size !== intent.source.revision.size ||
    archiveHash(observed.observation) !==
      archiveHash({
        intentId: intent.id,
        intentDefinitionHash: intent.definitionHash,
        bucket: intent.bucket,
        key: intent.destination.key,
        revision,
        sha256: intent.source.sha256,
      })
  )
    throw invalidStaging();
  return observed;
}
