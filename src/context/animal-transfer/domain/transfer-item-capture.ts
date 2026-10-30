import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveCaptureExpectation,
  OwnershipArchive,
} from './ownership-archive';
import { AnimalOwnershipControl } from './animal-ownership';
import { assertArchiveReservationControl } from './ownership-archive-reservation';
import {
  AcceptanceItem,
  AcceptanceRequest,
} from './transfer-acceptance-preparation';
import {
  AcceptanceStartBinding,
  readAcceptanceStartReceipt,
} from './transfer-acceptance-start';

export type ItemCaptureInput = Readonly<{
  actorId: string;
  transferId: string;
  itemId: string;
  decisionOperationId: string;
  expectedRequestVersion: number;
  expectedCaptureRevision: number;
}>;
export type ItemCaptureProgress = Readonly<{
  transferId: string;
  itemId: string;
  requestVersion: number;
  captureRevision: number;
  phase: 'ANIMAL' | 'DIARY' | 'MEDICAL' | 'COMPLETE';
  entryCount: number;
  stage: 'COLLECTING' | 'CAPTURE_SEALED';
  reservation: 'OBSERVED_ONLY';
  stableCut: 'NOT_ASSESSED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export type ItemCaptureScope = Readonly<{
  archiveId: string;
  expectation: ArchiveCaptureExpectation;
}>;
export type ItemCaptureAdmission =
  | { scope: ItemCaptureScope }
  | { progress: ItemCaptureProgress };
export interface ItemCaptureStore {
  admit(input: ItemCaptureInput): Promise<ItemCaptureAdmission>;
  observe(input: ItemCaptureInput): Promise<ItemCaptureProgress>;
}
export type ItemCaptureSnapshot = {
  request: (AcceptanceRequest & { captureStepRevision?: number }) | null;
  item: (AcceptanceItem & { captureStepRevision?: number }) | null;
  claim: {
    _id: string;
    transferId: string;
    acceptanceOperationId?: string;
    captureStepRevision?: number;
  } | null;
  archive: OwnershipArchive | null;
  control: AnimalOwnershipControl | null;
};
export function itemCaptureInput(raw: ItemCaptureInput): ItemCaptureInput {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !==
      'actorId,decisionOperationId,expectedCaptureRevision,expectedRequestVersion,itemId,transferId' ||
    ![raw.actorId, raw.transferId, raw.itemId, raw.decisionOperationId].every(
      isUuid,
    ) ||
    !Number.isSafeInteger(raw.expectedRequestVersion) ||
    raw.expectedRequestVersion < 2 ||
    !Number.isSafeInteger(raw.expectedCaptureRevision) ||
    raw.expectedCaptureRevision < 0 ||
    raw.expectedCaptureRevision >= Number.MAX_SAFE_INTEGER
  )
    throw new InvalidArgumentError('Invalid item capture selector');
  return Object.freeze({
    ...raw,
    decisionOperationId: raw.decisionOperationId.toLowerCase(),
  });
}
export function nextItemCaptureFence(revision: number | undefined) {
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision >= Number.MAX_SAFE_INTEGER)
  )
    throw new ConflictError(
      'Item capture admission fence is inconsistent or exhausted',
    );
  return (revision ?? 0) + 1;
}
export function selectItemCapture(
  input: ItemCaptureInput,
  request: ItemCaptureSnapshot['request'],
) {
  if (!request) throw new ResourceNotFoundError('Transfer request not found');
  if (request.recipientId !== input.actorId)
    throw new ForbiddenError(
      'Only the recipient can advance this item capture',
    );
  const binding = request.acceptanceStart as AcceptanceStartBinding | undefined;
  const selectedRows: AcceptanceStartBinding['selected'] | undefined =
    binding?.selected;
  if (
    !binding ||
    !selectedRows ||
    !Array.isArray(binding.selected) ||
    selectedRows.some((s) => !s || !isUuid(s.animalId))
  )
    throw new ConflictError(
      'The transfer has no supported acceptance start binding',
    );
  const receipt = readAcceptanceStartReceipt(
    {
      actorId: input.actorId,
      transferId: input.transferId,
      operationId: input.decisionOperationId,
      expectedVersion: input.expectedRequestVersion - 1,
      acceptedAnimalIds: selectedRows.map((s) => s.animalId),
    },
    request,
  );
  const selected = receipt?.binding.selected.find(
    (s) => s.itemId === input.itemId,
  );
  if (!selected)
    throw new ConflictError(
      'The item is not selected in the original decision',
    );
  return { request, selected };
}
export function assessItemCapture(
  raw: ItemCaptureInput,
  snapshot: ItemCaptureSnapshot,
) {
  const input = itemCaptureInput(raw),
    { item, claim, archive, control } = snapshot;
  const { request, selected } = selectItemCapture(input, snapshot.request);
  if (
    !item ||
    item._id !== selected.itemId ||
    item.transferId !== input.transferId ||
    item.status !== 'PROCESSING' ||
    item.animalId !== selected.animalId ||
    item.expectedOwnerId !== request.senderId ||
    item.expectedOwnershipVersion !== 1 ||
    item.captureArchiveId !== selected.archiveId ||
    item.captureReservationEpoch !== selected.reservationEpoch ||
    !claim ||
    claim._id !== selected.animalId ||
    claim.transferId !== input.transferId ||
    claim.acceptanceOperationId !== input.decisionOperationId ||
    !archive ||
    archive.id !== selected.archiveId ||
    archive.animalId !== selected.animalId ||
    archive.transferId !== input.transferId ||
    archive.ownerId !== request.senderId ||
    archive.recipientId !== input.actorId ||
    archive.ownershipVersion !== 1
  )
    throw new ConflictError(
      'The processing item, claim and capture header do not match the original decision',
    );
  assertArchiveReservationControl(archive, control);
  if (
    control?.activeWrites !== undefined &&
    !Array.isArray(control.activeWrites)
  )
    throw new ConflictError('The capture writer state is inconsistent');
  if (
    archive.reservation!.epoch !== selected.reservationEpoch ||
    !archive.capture ||
    !Number.isSafeInteger(archive.capture.revision) ||
    archive.capture.revision < input.expectedCaptureRevision ||
    !Number.isSafeInteger(archive.capture.entryCount) ||
    archive.capture.entryCount < 0 ||
    !['ANIMAL', 'DIARY', 'MEDICAL', 'COMPLETE'].includes(
      archive.capture.phase,
    ) ||
    !['COLLECTING', 'COPYING', 'READY'].includes(archive.state) ||
    (archive.state !== 'COLLECTING' && archive.capture.phase !== 'COMPLETE')
  )
    throw new ConflictError(
      'The capture progress or original reservation is inconsistent',
    );
  const progress: ItemCaptureProgress = Object.freeze({
    transferId: input.transferId,
    itemId: input.itemId,
    requestVersion: request.version,
    captureRevision: archive.capture.revision,
    phase: archive.capture.phase,
    entryCount: archive.capture.entryCount,
    stage: archive.state === 'COLLECTING' ? 'COLLECTING' : 'CAPTURE_SEALED',
    reservation: 'OBSERVED_ONLY',
    stableCut: 'NOT_ASSESSED',
    businessCommit: 'NOT_AUTHORIZED',
  });
  return {
    progress,
    needsWork:
      archive.state === 'COLLECTING' &&
      archive.capture.revision === input.expectedCaptureRevision,
    scope: Object.freeze({
      archiveId: archive.id,
      expectation: Object.freeze({
        definitionHash: archive.definitionHash,
        reservationEpoch: selected.reservationEpoch,
        revision: archive.capture.revision,
      }),
    }),
  };
}
