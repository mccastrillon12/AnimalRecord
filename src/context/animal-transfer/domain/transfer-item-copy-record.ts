import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCaptureInput,
  ItemCaptureSnapshot,
  inspectItemCopyPreparation,
  itemCaptureInput,
} from './transfer-item-capture';
import {
  ItemHistoricalCopyPreparationInput,
  historicalCopyPreparationInput,
  ItemArchiveCopyIntent,
  ItemCopyIntentContext,
} from './transfer-item-copy-intent';
import {
  buildItemCopyAttemptIntent,
  ItemCopyAttemptIntent,
} from './transfer-item-copy-attempt';

export const ITEM_COPY_RECORD_PROTOCOL = 'ITEM_COPY_RECORDS_V1' as const;
export type ItemCopyGateDefinition = Readonly<{
  id: string;
  binding: Omit<
    ItemArchiveCopyIntent['binding'],
    'fileId' | 'fileDefinitionHash'
  >;
  definitionHash: string;
}>;
export type ItemCopyGateRecord = ItemCopyGateDefinition &
  Readonly<{
    protocol: typeof ITEM_COPY_RECORD_PROTOCOL;
    row: 'GATE';
    gateId: string;
    revision: number;
    state: 'OPEN' | 'REVOKED';
    identityIds: readonly string[];
    revocation?: Readonly<{ requestId: string; evidenceRef: string }>;
  }>;
export type ItemCopyAttemptRecord = Readonly<{
  protocol: typeof ITEM_COPY_RECORD_PROTOCOL;
  row: 'ATTEMPT';
  id: string;
  gateId: string;
  copyIntentId: string;
  ordinal: 1;
  state: 'INTENDED';
  identityIds: readonly string[];
  definition: ItemCopyAttemptIntent;
}>;
export type ItemCopyRecord = ItemCopyGateRecord | ItemCopyAttemptRecord;
export type ItemCopyDeclarationInput = Readonly<{
  preparation: ItemHistoricalCopyPreparationInput;
  kind: ItemArchiveCopyIntent['kind'];
  attemptId: string;
  dispatcherInstanceId: string;
  origin: 'INITIAL';
  expectedGateRevision: number;
}>;
export type ItemCopyRevocationInput = Readonly<{
  selector: ItemCaptureInput;
  expectedGateRevision?: number;
  requestId: string;
  evidenceRef: string;
}>;
export type ItemCopyRecordReceipt = Readonly<{
  gateId: string;
  gateRevision: number;
  state: 'OPEN' | 'REVOKED';
  replayed: boolean;
  attemptId?: string;
  attemptDefinitionHash?: string;
  reservation: 'FENCED_AT_PREPARATION';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
}>;
export interface ItemCopyRecordStore {
  readCopyGate(input: ItemCaptureInput): Promise<ItemCopyGateRecord | null>;
  openCopyGate(input: ItemCaptureInput): Promise<ItemCopyRecordReceipt>;
  revokeCopyGate(
    input: ItemCopyRevocationInput,
  ): Promise<ItemCopyRecordReceipt>;
  declareCopyAttempt(
    input: ItemCopyDeclarationInput,
  ): Promise<ItemCopyRecordReceipt>;
}
const fail = (): never => {
  throw new ConflictError(
    'Item copy record identity, state or revision is inconsistent',
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
export function copyGateRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}
export function nextCopyGateRevision(value: number) {
  copyGateRevision(value);
  if (value >= Number.MAX_SAFE_INTEGER) fail();
  return value + 1;
}
export function copyDeclarationInput(
  raw: ItemCopyDeclarationInput,
): ItemCopyDeclarationInput {
  if (
    !keys(raw, [
      'preparation',
      'kind',
      'attemptId',
      'dispatcherInstanceId',
      'origin',
      'expectedGateRevision',
    ]) ||
    raw.origin !== 'INITIAL' ||
    !['HISTORICAL', 'RECIPIENT_STAGING'].includes(raw.kind)
  )
    fail();
  return Object.freeze({
    preparation: historicalCopyPreparationInput(raw.preparation),
    kind: raw.kind,
    attemptId: uuid(raw.attemptId),
    dispatcherInstanceId: uuid(raw.dispatcherInstanceId),
    origin: 'INITIAL',
    expectedGateRevision: copyGateRevision(raw.expectedGateRevision),
  });
}
export function copyRevocationInput(
  raw: ItemCopyRevocationInput,
): ItemCopyRevocationInput {
  if (
    !keys(
      raw,
      ['selector', 'requestId', 'evidenceRef'],
      ['expectedGateRevision'],
    )
  )
    fail();
  return Object.freeze({
    selector: itemCaptureInput(raw.selector),
    ...revocationRef({
      requestId: raw.requestId,
      evidenceRef: raw.evidenceRef,
    }),
    ...(raw.expectedGateRevision === undefined
      ? {}
      : { expectedGateRevision: copyGateRevision(raw.expectedGateRevision) }),
  });
}
function revocationRef(raw: NonNullable<ItemCopyGateRecord['revocation']>) {
  if (
    !keys(raw, ['requestId', 'evidenceRef']) ||
    typeof raw.evidenceRef !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(raw.evidenceRef)
  )
    fail();
  return Object.freeze({
    requestId: uuid(raw.requestId),
    evidenceRef: raw.evidenceRef,
  });
}
export function buildItemCopyGate(
  input: ItemCaptureInput,
  snapshot: ItemCaptureSnapshot,
): ItemCopyGateDefinition {
  const inspected = inspectItemCopyPreparation(input, snapshot);
  const binding = Object.freeze({
    transferId: input.transferId,
    itemId: input.itemId,
    requestVersion: input.expectedRequestVersion,
    observedSeal: Object.freeze({ ...inspected.observedSeal }),
    observedSealHash: inspected.observedSealHash,
  });
  const seal = binding.observedSeal;
  // Stable across files, stages, bucket and digest; changed seals cannot evade a tombstone.
  const id = archiveHash([
    ITEM_COPY_RECORD_PROTOCOL,
    input.transferId,
    input.itemId,
    seal.acceptanceBindingHash,
    seal.reservationBindingHash,
    seal.reservationEpoch,
  ]);
  return Object.freeze({
    id,
    binding,
    definitionHash: archiveHash({
      protocol: ITEM_COPY_RECORD_PROTOCOL,
      id,
      binding,
    }),
  });
}
export function newItemCopyGate(
  definition: ItemCopyGateDefinition,
  revocation?: ItemCopyGateRecord['revocation'],
): ItemCopyGateRecord {
  return Object.freeze({
    ...definition,
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'GATE',
    gateId: definition.id,
    state: revocation ? 'REVOKED' : 'OPEN',
    revision: 0,
    identityIds: Object.freeze(
      revocation ? [definition.id, revocation.requestId] : [definition.id],
    ),
    ...(revocation ? { revocation: Object.freeze({ ...revocation }) } : {}),
  });
}
export function captureItemCopyGate(
  raw: ItemCopyGateRecord,
  expected: ItemCopyGateDefinition,
): ItemCopyGateRecord {
  if (
    !keys(
      raw,
      [
        'id',
        'binding',
        'definitionHash',
        'protocol',
        'row',
        'gateId',
        'state',
        'revision',
        'identityIds',
      ],
      ['revocation'],
    ) ||
    raw.protocol !== ITEM_COPY_RECORD_PROTOCOL ||
    raw.row !== 'GATE' ||
    !['OPEN', 'REVOKED'].includes(raw.state)
  )
    fail();
  copyGateRevision(raw.revision);
  if (
    raw.state === 'OPEN'
      ? raw.revocation !== undefined
      : !keys(raw.revocation, ['requestId', 'evidenceRef'])
  )
    fail();
  let revocation: ItemCopyGateRecord['revocation'];
  if (raw.state === 'REVOKED') {
    revocation = revocationRef(raw.revocation!);
  }
  const canonical = {
    ...newItemCopyGate(expected, revocation),
    revision: raw.revision,
  };
  if (archiveHash(raw) !== archiveHash(canonical)) fail();
  return Object.freeze(canonical);
}
export function newItemCopyAttempt(
  context: ItemCopyIntentContext,
  input: ItemCopyDeclarationInput,
  gateId: string,
): ItemCopyAttemptRecord {
  const definition = buildItemCopyAttemptIntent(context, input.kind, {
    attemptId: input.attemptId,
    dispatcherInstanceId: input.dispatcherInstanceId,
    origin: 'INITIAL',
  });
  return Object.freeze({
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'ATTEMPT',
    id: definition.id,
    gateId,
    copyIntentId: definition.copyIntentId,
    ordinal: 1,
    state: 'INTENDED',
    identityIds: Object.freeze([definition.id]),
    definition,
  });
}
export function matchItemCopyAttempt(
  raw: ItemCopyAttemptRecord,
  expected: ItemCopyAttemptRecord,
) {
  if (archiveHash(raw) !== archiveHash(expected)) fail();
}
