import {
  AcceptanceCandidate,
  AcceptanceRequest,
  AcceptanceSelection,
  acceptanceSelection,
} from './transfer-acceptance-preparation';
import { archiveHash } from './ownership-archive';
import { transferRecordId } from './transfer-record-id';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { validate as isUuid } from 'uuid';

export const ACCEPTANCE_START_PROTOCOL =
  'TRANSFER_ACCEPTANCE_START_V1' as const;
export type AcceptanceStartBinding = Readonly<{
  protocol: typeof ACCEPTANCE_START_PROTOCOL;
  candidateId: string;
  selectionHash: string;
  inputHash: string;
  bindingHash: string;
  operationId: string;
  expectedVersion: number;
  startedAt: string;
  selected: readonly Readonly<{
    itemId: string;
    animalId: string;
    archiveId: string;
    reservationEpoch: number;
  }>[];
  rejectedItemIds: readonly string[];
}>;
/** An immutable receipt of the decision, never current authorization to copy/commit. */
export type AcceptanceStartReceipt = Readonly<{
  transferId: string;
  requestVersion: number;
  binding: AcceptanceStartBinding;
  replayed: boolean;
  reservation: 'RECORDED_AT_START';
  stableCut: 'NOT_ASSESSED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export interface AcceptanceStartStore {
  start(input: AcceptanceSelection): Promise<AcceptanceStartReceipt>;
}
export interface AcceptanceArchiveKeyResolver {
  // Must be a pure resolver for the configured bucket/origin. No SDK, network or writes.
  keyFromUrl(url: string): string | undefined;
}
export function acceptanceInputHash(input: AcceptanceSelection): string {
  return archiveHash(acceptanceSelection(input));
}
function freezeBinding(
  binding: AcceptanceStartBinding,
): AcceptanceStartBinding {
  return Object.freeze({
    ...binding,
    selected: Object.freeze(
      binding.selected.map((s) => Object.freeze({ ...s })),
    ),
    rejectedItemIds: Object.freeze([...binding.rejectedItemIds]),
  });
}
export function buildAcceptanceStartBinding(
  candidate: AcceptanceCandidate,
  input: AcceptanceSelection,
  at: string,
): AcceptanceStartBinding {
  const binding = {
    protocol: ACCEPTANCE_START_PROTOCOL,
    candidateId: candidate.candidateId,
    selectionHash: candidate.selectionHash,
    inputHash: acceptanceInputHash(input),
    operationId: candidate.operationId,
    expectedVersion: candidate.requestVersion,
    startedAt: at,
    selected: candidate.selected.map((s) => ({
      itemId: s.itemId,
      animalId: s.animalId,
      archiveId: s.definition.id,
      reservationEpoch: s.proposedReservationEpoch,
    })),
    rejectedItemIds: candidate.rejectedItemIds,
  };
  return freezeBinding({ ...binding, bindingHash: archiveHash(binding) });
}
export function acceptanceStartReceipt(
  transferId: string,
  binding: AcceptanceStartBinding,
  replayed: boolean,
): AcceptanceStartReceipt {
  return Object.freeze({
    transferId,
    requestVersion: binding.expectedVersion + 1,
    binding: freezeBinding(binding),
    replayed,
    reservation: 'RECORDED_AT_START',
    stableCut: 'NOT_ASSESSED',
    businessCommit: 'NOT_AUTHORIZED',
  });
}
/** Does not read/adopt the current lock. A replay does not authorize resending work. */
export function readAcceptanceStartReceipt(
  raw: AcceptanceSelection,
  request: AcceptanceRequest | null,
): AcceptanceStartReceipt | undefined {
  const input = acceptanceSelection(raw);
  if (!request) throw new ResourceNotFoundError('Transfer request not found');
  if (request.recipientId !== input.actorId)
    throw new ForbiddenError('Only the recipient can start acceptance');
  if (request.status === 'PENDING') return undefined;
  const binding = request.acceptanceStart as AcceptanceStartBinding | undefined;
  const conflict = () =>
    new ConflictError(
      'Acceptance decision differs or its immutable start receipt is inconsistent',
    );
  if (
    !binding ||
    typeof binding !== 'object' ||
    Object.keys(binding).sort().join(',') !==
      'bindingHash,candidateId,expectedVersion,inputHash,operationId,protocol,rejectedItemIds,selected,selectionHash,startedAt' ||
    request._id !== input.transferId ||
    request.status !== 'PROCESSING' ||
    request.version !== input.expectedVersion + 1 ||
    request.decisionOperationId !== input.operationId ||
    request.decisionExpectedVersion !== input.expectedVersion ||
    request.decidedAt !== binding.startedAt ||
    binding.protocol !== ACCEPTANCE_START_PROTOCOL ||
    binding.operationId !== input.operationId ||
    binding.expectedVersion !== input.expectedVersion ||
    binding.inputHash !== acceptanceInputHash(input) ||
    binding.candidateId !==
      transferRecordId(
        'acceptance-candidate',
        input.transferId,
        `${input.actorId}/${input.operationId}`,
      ) ||
    typeof binding.selectionHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(binding.selectionHash) ||
    !Number.isFinite(Date.parse(binding.startedAt)) ||
    new Date(binding.startedAt).toISOString() !== binding.startedAt ||
    !Array.isArray(binding.selected) ||
    !Array.isArray(binding.rejectedItemIds)
  )
    throw conflict();
  const { bindingHash, ...payload } = binding;
  if (bindingHash !== archiveHash(payload)) throw conflict();
  const selected: AcceptanceStartBinding['selected'] = binding.selected;
  const rejected: readonly string[] = binding.rejectedItemIds;
  if (
    selected.length !== input.acceptedAnimalIds.length ||
    selected.some(
      (s, index) =>
        !s ||
        Object.keys(s).sort().join(',') !==
          'animalId,archiveId,itemId,reservationEpoch' ||
        s.animalId !== input.acceptedAnimalIds[index] ||
        s.itemId !== transferRecordId('item', input.transferId, s.animalId) ||
        s.archiveId !==
          transferRecordId(
            'acceptance-archive',
            binding.candidateId,
            s.itemId,
          ) ||
        !Number.isSafeInteger(s.reservationEpoch) ||
        s.reservationEpoch < 1,
    ) ||
    !Number.isSafeInteger(request.animalCount) ||
    selected.length + rejected.length !== request.animalCount ||
    new Set(rejected).size !== rejected.length ||
    rejected.some(
      (id, index) =>
        !isUuid(id) ||
        (index > 0 && id <= rejected[index - 1]) ||
        selected.some((s) => s.itemId === id),
    )
  )
    throw conflict();
  return acceptanceStartReceipt(input.transferId, binding, true);
}
