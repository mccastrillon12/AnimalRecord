import { ClientSession } from 'mongoose';
import {
  AnimalTransferReasonCode,
  AnimalTransferRejectionReasonCode,
  INITIAL_ANIMAL_TRANSFER_REJECTION_REASONS,
} from '../../catalogs/domain/animal-transfer-reason';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import type { AcceptanceStartBinding } from './transfer-acceptance-start';
import type { TransferItemOwnershipCommit } from './transfer-item-ownership-commit';
export class TransferRequestCollision extends ConflictError {
  constructor() {
    super(
      'An animal already has an active transfer request or creation raced; retry with the same key',
    );
  }
}

export const TRANSFER_REQUEST_STATUSES = [
  'PENDING',
  'REJECTED',
  'PROCESSING',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'EXPIRED',
] as const;
export const TRANSFER_ITEM_STATUSES = [
  'PENDING',
  'REJECTED',
  'PROCESSING',
  'ACCEPTED',
  'EXPIRED',
] as const;
export const TRANSFER_LIST_FILTERS = [
  'PENDING',
  'REJECTED',
  'EXPIRED',
] as const;

export function transferExpiresAt(createdAt: Date): string {
  return new Date(createdAt.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
}

export function isTransferExpired(
  request: { status: string; expiresAt?: string },
  at: string,
): boolean {
  return (
    request.status === 'EXPIRED' ||
    (request.status === 'PENDING' &&
      request.expiresAt !== undefined &&
      request.expiresAt <= at)
  );
}

export function assertTransferDecisionOpen(
  request: { status: string; expiresAt?: string },
  at: string,
): void {
  const expiresAt = request.expiresAt;
  if (
    expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString() !== expiresAt)
  )
    throw new ConflictError('Transfer expiration is inconsistent');
  if (isTransferExpired(request, at))
    throw new ConflictError('Transfer request has expired');
}

export type CreateTransferRequestInput = {
  recipientId: string;
  reasonCode: AnimalTransferReasonCode;
  reasonComment?: string;
  animalIds: string[];
  authorization: { challengeId: string; proof: string };
};
export type TransferRequestRecord = {
  _id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  reasonCode: AnimalTransferReasonCode;
  reasonName: string;
  reasonComment?: string;
  rejectionReasonCode?: AnimalTransferRejectionReasonCode;
  rejectionReasonName?: string;
  rejectionComment?: string;
  status: (typeof TRANSFER_REQUEST_STATUSES)[number];
  version: number;
  createdAt: string;
  expiresAt?: string;
  expiredAt?: string;
  animalCount: number;
  bodyHash: string;
  authorizationChallengeId: string;
  decidedAt?: string;
  decisionOperationId?: string;
  decisionExpectedVersion?: number;
  acceptanceStart?: AcceptanceStartBinding;
  captureStepRevision?: number;
  inboundPushRevision?: number;
  acceptedItemCount?: number;
};
export type TransferAnimalAge =
  | { type: 'EXACT'; months: number }
  | { type: 'APPROXIMATE'; minMonths: number; maxMonths: number };
type TransferAnimalSummary = {
  animalId: string;
  animalName: string;
  animalCode: string;
  animalBreed?: string;
  animalSex?: string;
  animalAge?: TransferAnimalAge;
};
export type TransferRequestItem = TransferAnimalSummary & {
  _id: string;
  transferId: string;
  expectedOwnerId: string;
  expectedOwnershipVersion: number;
  status: (typeof TRANSFER_ITEM_STATUSES)[number];
  captureArchiveId?: string;
  captureReservationEpoch?: number;
  captureStepRevision?: number;
  ownershipCommit?: TransferItemOwnershipCommit;
};
export type RequestAnimal = Omit<TransferAnimalSummary, 'animalAge'> & {
  expectedOwnershipVersion: number;
  birthDate?: string;
  unknownBirthDate?: boolean;
  approximateAgeMinMonths?: number;
  approximateAgeMaxMonths?: number;
};
export type TransferRequestSummary = Omit<
  TransferRequestRecord,
  | '_id'
  | 'bodyHash'
  | 'authorizationChallengeId'
  | 'decisionOperationId'
  | 'decisionExpectedVersion'
  | 'acceptanceStart'
  | 'captureStepRevision'
  | 'inboundPushRevision'
  | 'acceptedItemCount'
> & { id: string };
export type TransferRequestItemResponse = TransferAnimalSummary & {
  id: string;
  status: TransferRequestItem['status'];
  animalProfilePictureUrl?: string;
};
export type RequestListAfter = { at: string; id: string };
export type DueTransfer = { _id: string; expiresAt: string };
export interface TransferRequestTransaction {
  session: ClientSession;
  find(id: string): Promise<TransferRequestRecord | null>;
  items(
    transferId: string,
    limit: number,
    afterAnimalId?: string,
  ): Promise<TransferRequestItem[]>;
  photoSources(
    animalIds: readonly string[],
    ownerIds: readonly string[],
  ): Promise<
    Array<{ id: string; ownerId: string; profilePictureUrl?: string }>
  >;
  rejectAll(
    request: TransferRequestRecord,
    operationId: string,
    at: string,
  ): Promise<TransferRequestRecord>;
  expire(request: TransferRequestRecord, at: string): Promise<void>;
  profile(id: string): Promise<{ id: string; name: string } | null>;
  reason(
    code: AnimalTransferReasonCode,
  ): Promise<{ code: AnimalTransferReasonCode; name: string } | null>;
  animals(ids: readonly string[], actorId: string): Promise<RequestAnimal[]>;
  save(
    request: TransferRequestRecord,
    items: TransferRequestItem[],
  ): Promise<void>;
}

export type TransferRejection = Readonly<{
  rejectionReasonCode?: AnimalTransferRejectionReasonCode;
  rejectionComment?: string;
}>;
export function transferReasonComment(
  code: string | undefined,
  raw: unknown,
): string | undefined {
  if (raw === undefined) return undefined;
  if (
    typeof raw !== 'string' ||
    code !== 'OTHER' ||
    !raw.trim() ||
    raw.trim().length > 500
  )
    throw new InvalidArgumentError(
      'OTHER requires a comment of 1-500 characters; other reasons do not accept a comment',
    );
  return raw.trim();
}
export function transferRejection(raw: TransferRejection): TransferRejection {
  const code = raw.rejectionReasonCode;
  if (
    code !== undefined &&
    !Object.values(AnimalTransferRejectionReasonCode).includes(code)
  )
    throw new InvalidArgumentError('Invalid transfer rejection reason');
  const comment = transferReasonComment(code, raw.rejectionComment);
  if (code === AnimalTransferRejectionReasonCode.Other && !comment)
    throw new InvalidArgumentError('OTHER requires a rejection comment');
  return Object.freeze({
    ...(code !== undefined ? { rejectionReasonCode: code } : {}),
    ...(comment !== undefined ? { rejectionComment: comment } : {}),
  });
}
export function transferRejectionFields(raw: TransferRejection) {
  const normalized = transferRejection(raw);
  const reason = INITIAL_ANIMAL_TRANSFER_REJECTION_REASONS.find(
    (row) => row.code === normalized.rejectionReasonCode,
  );
  return {
    ...normalized,
    ...(reason ? { rejectionReasonName: reason.name } : {}),
  };
}
export interface TransferRequestStore {
  transaction<T>(
    work: (tx: TransferRequestTransaction) => Promise<T>,
  ): Promise<T>;
  find(id: string): Promise<TransferRequestRecord | null>;
  list(
    actorId: string,
    direction: 'INCOMING' | 'OUTGOING',
    limit: number,
    after?: RequestListAfter,
    status?: TransferRequestRecord['status'],
    at?: string,
  ): Promise<TransferRequestRecord[]>;
  listDue(
    at: string,
    limit: number,
    after?: DueTransfer,
  ): Promise<DueTransfer[]>;
  items(
    transferId: string,
    limit: number,
    afterAnimalId?: string,
  ): Promise<TransferRequestItem[]>;
}
