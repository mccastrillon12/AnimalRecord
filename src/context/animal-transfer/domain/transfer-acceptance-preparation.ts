import { validate as isUuid } from 'uuid';
import { createHash } from 'node:crypto';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { transferRecordId } from './transfer-record-id';
import { ArchiveDefinition } from './ownership-archive';
import { nextReservationEpoch } from './reservation-epoch';

export type AcceptanceSelection = Readonly<{
  actorId: string;
  transferId: string;
  operationId: string;
  expectedVersion: number;
  acceptedAnimalIds: readonly string[];
}>;
export type AcceptanceRequest = {
  _id: string;
  senderId: string;
  recipientId: string;
  status: string;
  version: number;
  animalCount: number;
  decidedAt?: string;
  decisionOperationId?: string;
  decisionExpectedVersion?: number;
  acceptanceStart?: unknown;
  acceptedItemCount?: number;
};
export type AcceptanceItem = {
  _id: string;
  transferId: string;
  animalId: string;
  expectedOwnerId: string;
  expectedOwnershipVersion: number;
  status: string;
  captureArchiveId?: string;
  captureReservationEpoch?: number;
};
export type AcceptanceSnapshot = {
  request: AcceptanceRequest | null;
  items: AcceptanceItem[];
  claims: Array<{
    _id: string;
    transferId: string;
    acceptanceOperationId?: string;
  }>;
  animals: Array<{ id: string; ownerId: string; isActive?: boolean | null }>;
  controls: Array<{
    animalId: string;
    ownerId: string;
    ownershipVersion: number;
    reservationEpoch?: number;
    lockPresent: boolean;
    writersPresent: boolean;
    uploadsValidUntil?: string;
  }>;
  periods: Array<{
    id: string;
    animalId: string;
    ownerId: string;
    ownershipVersion: number;
    status: string;
    archiveId?: string;
  }>;
  pendingMedicalAnimalIds: string[];
};
export type AcceptanceCandidate = Readonly<{
  protocol: 'TRANSFER_ACCEPTANCE_CANDIDATE_V1';
  candidateId: string;
  selectionHash: string;
  transferId: string;
  requestVersion: number;
  actorId: string;
  senderId: string;
  operationId: string;
  observedAt: string;
  selected: readonly Readonly<{
    itemId: string;
    animalId: string;
    definition: Readonly<ArchiveDefinition>;
    predecessorArchiveId?: string;
    expectedReservationEpoch?: number;
    proposedReservationEpoch: number;
  }>[];
  rejectedItemIds: readonly string[];
  decision: 'NOT_RECORDED';
  reservation: 'NOT_ACQUIRED';
  capturePreflight: 'NOT_RUN';
  stableCut: 'NOT_ASSESSED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export interface AcceptancePreparationStore {
  // All sources must be read in one caller-free snapshot transaction. The result
  // is observation only, never a fence or a capability to invoke capture.start.
  snapshot<T>(
    input: AcceptanceSelection,
    work: (snapshot: AcceptanceSnapshot) => T,
  ): Promise<T>;
}
export function acceptanceSelection(
  raw: AcceptanceSelection,
): AcceptanceSelection {
  const selectedIds: readonly string[] = raw?.acceptedAnimalIds;
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !==
      'acceptedAnimalIds,actorId,expectedVersion,operationId,transferId' ||
    !isUuid(raw.actorId) ||
    !isUuid(raw.transferId) ||
    !isUuid(raw.operationId) ||
    !Number.isSafeInteger(raw.expectedVersion) ||
    raw.expectedVersion < 1 ||
    raw.expectedVersion >= Number.MAX_SAFE_INTEGER ||
    !Array.isArray(raw.acceptedAnimalIds) ||
    !raw.acceptedAnimalIds.length ||
    selectedIds.some((id) => !isUuid(id)) ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new InvalidArgumentError('Invalid acceptance preparation selection');
  return Object.freeze({
    actorId: raw.actorId,
    transferId: raw.transferId,
    operationId: raw.operationId.toLowerCase(),
    expectedVersion: raw.expectedVersion,
    acceptedAnimalIds: Object.freeze([...selectedIds].sort()),
  });
}
export function assertAcceptanceRequest(
  request: AcceptanceRequest | null,
  input: AcceptanceSelection,
): asserts request is AcceptanceRequest {
  if (!request) throw new ResourceNotFoundError('Transfer request not found');
  if (request.recipientId !== input.actorId)
    throw new ForbiddenError('Only the recipient can prepare acceptance');
  if (
    request._id !== input.transferId ||
    !isUuid(request.senderId) ||
    request.senderId === request.recipientId ||
    request.status !== 'PENDING' ||
    request.version !== input.expectedVersion ||
    !Number.isSafeInteger(request.animalCount) ||
    request.animalCount < 1 ||
    request.decidedAt !== undefined ||
    request.decisionOperationId !== undefined ||
    request.decisionExpectedVersion !== undefined ||
    request.acceptanceStart !== undefined
  )
    throw new ConflictError('Transfer request changed or is inconsistent');
}
export function buildAcceptanceCandidate(
  raw: AcceptanceSelection,
  snapshot: AcceptanceSnapshot,
  observedAt: string,
  mode: 'INITIAL' | 'WITH_PUBLISHED_HISTORY' = 'INITIAL',
): AcceptanceCandidate {
  const input = acceptanceSelection(raw),
    request = snapshot.request;
  assertAcceptanceRequest(request, input);
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    new Date(observedAt).toISOString() !== observedAt
  )
    throw new InvalidArgumentError('Invalid acceptance observation time');
  const { items, claims } = snapshot;
  if (
    items.length !== request.animalCount ||
    new Set(items.map((i) => i.animalId)).size !== items.length ||
    items.some(
      (i) =>
        !isUuid(i.animalId) ||
        i._id !== transferRecordId('item', request._id, i.animalId) ||
        i.transferId !== request._id ||
        i.expectedOwnerId !== request.senderId ||
        !Number.isSafeInteger(i.expectedOwnershipVersion) ||
        i.expectedOwnershipVersion < 1 ||
        i.status !== 'PENDING' ||
        i.captureArchiveId !== undefined ||
        i.captureReservationEpoch !== undefined,
    )
  )
    throw new ConflictError(
      'Acceptance requires the complete pending item set',
    );
  if (
    claims.length !== items.length ||
    new Set(claims.map((c) => c._id)).size !== items.length ||
    claims.some(
      (c) =>
        c.transferId !== request._id ||
        c.acceptanceOperationId !== undefined ||
        !items.some((i) => i.animalId === c._id),
    )
  )
    throw new ConflictError('Acceptance request claims are inconsistent');
  if (
    input.acceptedAnimalIds.some((id) => !items.some((i) => i.animalId === id))
  )
    throw new InvalidArgumentError(
      'Acceptance selection is outside the request',
    );
  const selectedItems = input.acceptedAnimalIds.map(
    (id) => items.find((i) => i.animalId === id)!,
  );
  if (
    snapshot.animals.length !== selectedItems.length ||
    snapshot.controls.length !== selectedItems.length ||
    new Set(snapshot.animals.map((a) => a.id)).size !== selectedItems.length ||
    new Set(snapshot.controls.map((c) => c.animalId)).size !==
      selectedItems.length ||
    snapshot.pendingMedicalAnimalIds.some(
      (id) => !input.acceptedAnimalIds.includes(id),
    )
  )
    throw new ConflictError('Acceptance source set is inconsistent');
  if (snapshot.pendingMedicalAnimalIds.length)
    throw new ConflictError(
      'The owner must finish or discard pending medical work before acceptance',
    );
  const candidateId = transferRecordId(
    'acceptance-candidate',
    request._id,
    `${input.actorId}/${input.operationId}`,
  );
  const selected = selectedItems.map((item) => {
    const animal = snapshot.animals.find((a) => a.id === item.animalId),
      control = snapshot.controls.find((c) => c.animalId === item.animalId);
    if (
      !animal ||
      animal.ownerId !== request.senderId ||
      (animal.isActive !== true && animal.isActive != null) ||
      !control ||
      control.ownerId !== request.senderId ||
      control.ownershipVersion !== item.expectedOwnershipVersion
    )
      throw new ConflictError(
        'Selected animal eligibility or ownership changed',
      );
    if (control.lockPresent !== false || control.writersPresent !== false)
      throw new ConflictError(
        'Selected animal is busy or reserved; no reservation was acquired',
      );
    if (
      control.uploadsValidUntil !== undefined &&
      (!Number.isFinite(Date.parse(control.uploadsValidUntil)) ||
        new Date(control.uploadsValidUntil).toISOString() !==
          control.uploadsValidUntil ||
        control.uploadsValidUntil > observedAt)
    )
      throw new ConflictError(
        'Selected animal upload window is not drained in this observation',
      );
    const periods = snapshot.periods.filter(
      (p) => p.animalId === item.animalId,
    );
    const laterPeriod =
      mode === 'WITH_PUBLISHED_HISTORY' && item.expectedOwnershipVersion > 1;
    // The published predecessor reader currently supports the initial publication.
    const version = laterPeriod ? 2 : 1;
    const active = periods.find((period) => period.status === 'ACTIVE');
    const predecessor = laterPeriod
      ? periods.find(
          (period) =>
            period.status === 'CLOSED' && period.ownershipVersion === 1,
        )
      : undefined;
    if (
      item.expectedOwnershipVersion !== version ||
      periods.length !== version ||
      !active ||
      active.ownershipVersion !== version ||
      active.ownerId !== request.senderId ||
      !isUuid(active.id) ||
      (laterPeriod && !isUuid(predecessor?.archiveId ?? ''))
    )
      throw new ConflictError(
        laterPeriod
          ? 'Later acceptance requires the active period and its initial closed predecessor'
          : 'Initial active ownership period required; retained history capture remains unavailable',
      );
    const proposedReservationEpoch = nextReservationEpoch(
      control.reservationEpoch,
    );
    const definition = Object.freeze({
      id: transferRecordId('acceptance-archive', candidateId, item._id),
      animalId: item.animalId,
      ownerId: request.senderId,
      recipientId: input.actorId,
      periodId: active.id,
      transferId: request._id,
      ownershipVersion: item.expectedOwnershipVersion,
    });
    return Object.freeze({
      itemId: item._id,
      animalId: item.animalId,
      definition,
      ...(predecessor?.archiveId
        ? { predecessorArchiveId: predecessor.archiveId }
        : {}),
      ...(control.reservationEpoch !== undefined
        ? { expectedReservationEpoch: control.reservationEpoch }
        : {}),
      proposedReservationEpoch,
    });
  });
  if (
    snapshot.periods.some((p) => !input.acceptedAnimalIds.includes(p.animalId))
  )
    throw new ConflictError('Acceptance period set is inconsistent');
  const rejectedItemIds = items
    .filter((i) => !input.acceptedAnimalIds.includes(i.animalId))
    .map((i) => i._id)
    .sort();
  const selectionHash = createHash('sha256')
    .update(
      JSON.stringify({
        protocol: 'TRANSFER_ACCEPTANCE_CANDIDATE_V1',
        candidateId,
        transferId: request._id,
        version: request.version,
        actorId: input.actorId,
        senderId: request.senderId,
        selected,
        rejectedItemIds,
      }),
    )
    .digest('hex');
  return Object.freeze({
    protocol: 'TRANSFER_ACCEPTANCE_CANDIDATE_V1',
    candidateId,
    selectionHash,
    transferId: request._id,
    requestVersion: request.version,
    actorId: input.actorId,
    senderId: request.senderId,
    operationId: input.operationId,
    observedAt,
    selected: Object.freeze(selected),
    rejectedItemIds: Object.freeze(rejectedItemIds),
    decision: 'NOT_RECORDED',
    reservation: 'NOT_ACQUIRED',
    capturePreflight: 'NOT_RUN',
    stableCut: 'NOT_ASSESSED',
    businessCommit: 'NOT_AUTHORIZED',
  });
}
