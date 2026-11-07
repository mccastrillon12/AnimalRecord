import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveCaptureExpectation,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import { AnimalOwnershipControl } from './animal-ownership';
import { assertArchiveReservationControl } from './ownership-archive-reservation';
import type {
  ItemHistoricalByteObservation,
  ItemStagingCopyPreparationReceipt,
  ItemSourceByteObservation,
  ItemSourceObservationReceipt,
  ItemStagingByteObservation,
  ItemStagingObservationReceipt,
} from './transfer-item-historical-observation';
import type {
  ItemManifestReadInput,
  ItemManifestPage,
  ItemManifestDigestInput,
  ItemManifestDigestResult,
  ItemManifestPreparationReceipt,
} from './transfer-item-manifest-digest';
import type {
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalCopyPreparationReceipt,
  ItemCopyIntentContext,
  ItemHistoricalSourceAnchorInput,
  ItemHistoricalSourceAnchorMaterial,
} from './transfer-item-copy-intent';
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
  resumeManifestDigest(
    input: ItemManifestDigestInput,
  ): Promise<ItemManifestPreparationReceipt | null>;
  /** Trusted observer only; never accept a digest DTO as proof through HTTP. */
  confirmManifestDigest(
    input: ItemManifestDigestInput,
    digest: ItemManifestDigestResult,
  ): Promise<ItemManifestPreparationReceipt>;
  readManifestPage(input: ItemManifestReadInput): Promise<ItemManifestPage>;
  admit(input: ItemCaptureInput): Promise<ItemCaptureAdmission>;
  observe(input: ItemCaptureInput): Promise<ItemCaptureProgress>;
  inspectCopyPreparation(
    input: ItemCaptureInput,
  ): Promise<ItemCopyPreparationInspection>;
  prepareHistoricalCopy(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemHistoricalCopyPreparationReceipt>;
  readHistoricalCopy(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemCopyIntentContext>;
  readHistoricalSourceForAnchor(
    input: ItemHistoricalSourceAnchorInput,
  ): Promise<ItemHistoricalSourceAnchorMaterial>;
  readStagingCopy(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemCopyIntentContext>;
  resumeStagingObservation(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemStagingObservationReceipt | null>;
  /** Trusted collector only, never a DTO with MATCH from HTTP. */
  confirmStagingObservation(
    input: ItemHistoricalCopyPreparationInput,
    observation: ItemStagingByteObservation,
  ): Promise<ItemStagingObservationReceipt>;
  resumeSourceObservation(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemSourceObservationReceipt | null>;
  /** Trusted collector only; never accept an observation DTO as remote proof. */
  confirmSourceObservation(
    input: ItemHistoricalCopyPreparationInput,
    observation: ItemSourceByteObservation,
  ): Promise<ItemSourceObservationReceipt>;
  resumeStagingCopy(
    input: ItemHistoricalCopyPreparationInput,
  ): Promise<ItemStagingCopyPreparationReceipt | null>;
  /** Trusted collector port only; never expose an observation DTO through HTTP. */
  confirmHistoricalObservation(
    input: ItemHistoricalCopyPreparationInput,
    observation: ItemHistoricalByteObservation,
  ): Promise<ItemStagingCopyPreparationReceipt>;
}
/** Local header observations only; never accepted by a copy dispatcher as permission. */
export type ItemCopyPreparationInspection = Readonly<{
  protocol: 'ITEM_COPY_PREPARATION_OBSERVATION_V1';
  transferId: string;
  itemId: string;
  requestVersion: number;
  observedSeal: Readonly<{
    acceptanceBindingHash: string;
    archiveId: string;
    definitionHash: string;
    reservationBindingHash: string;
    reservationEpoch: number;
    captureRevision: number;
    expectedEntryCount: number;
    expectedFileCount: number;
  }>;
  observedSealHash: string;
  status: 'BLOCKED';
  missingRequirements: readonly [
    'STABLE_CUT_EVIDENCE',
    'COPY_EFFECT_PROTOCOL',
    'ARTIFACT_RETENTION',
  ];
  reservation: 'OBSERVED_ONLY';
  stableCut: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
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

/** Counts are persisted seal claims, not a manifest digest or remote-closure evidence. */
export function inspectItemCopyPreparation(
  raw: ItemCaptureInput,
  snapshot: ItemCaptureSnapshot,
): ItemCopyPreparationInspection {
  const input = itemCaptureInput(raw);
  assessItemCapture(input, snapshot);
  const archive = snapshot.archive!;
  if (
    !['COPYING', 'READY'].includes(archive.state) ||
    archive.capture!.revision !== input.expectedCaptureRevision ||
    archive.capture!.phase !== 'COMPLETE' ||
    archive.capture!.afterId !== undefined ||
    !Number.isSafeInteger(archive.expectedEntryCount) ||
    archive.expectedEntryCount! < 1 ||
    archive.expectedEntryCount !== archive.capture!.entryCount ||
    !Number.isSafeInteger(archive.expectedFileCount) ||
    archive.expectedFileCount! < 0
  )
    throw new ConflictError(
      'Copy preparation inspection requires the exact sealed capture and persisted counts',
    );
  const observedSeal = Object.freeze({
    acceptanceBindingHash: (
      snapshot.request!.acceptanceStart as AcceptanceStartBinding
    ).bindingHash,
    archiveId: archive.id,
    definitionHash: archive.definitionHash,
    reservationBindingHash: archive.reservation!.bindingHash,
    reservationEpoch: archive.reservation!.epoch,
    captureRevision: archive.capture!.revision,
    expectedEntryCount: archive.expectedEntryCount,
    expectedFileCount: archive.expectedFileCount!,
  });
  const protocol = 'ITEM_COPY_PREPARATION_OBSERVATION_V1';
  const identity = {
    protocol,
    transferId: input.transferId,
    itemId: input.itemId,
    requestVersion: snapshot.request!.version,
    observedSeal,
  } as const;
  return Object.freeze({
    ...identity,
    observedSealHash: archiveHash(identity),
    status: 'BLOCKED',
    missingRequirements: Object.freeze([
      'STABLE_CUT_EVIDENCE',
      'COPY_EFFECT_PROTOCOL',
      'ARTIFACT_RETENTION',
    ] as const),
    reservation: 'OBSERVED_ONLY',
    stableCut: 'NOT_ASSESSED',
    copyDispatch: 'NOT_AUTHORIZED',
    businessCommit: 'NOT_AUTHORIZED',
  });
}
