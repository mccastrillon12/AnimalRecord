import { ClientSession } from 'mongoose';
import { AnimalTransferReasonCode } from '../../catalogs/domain/animal-transfer-reason';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
export class TransferRequestCollision extends ConflictError {
  constructor() {
    super(
      'An animal already has an active transfer request or creation raced; retry with the same key',
    );
  }
}

export type CreateTransferRequestInput = {
  recipientId: string;
  reasonCode: AnimalTransferReasonCode;
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
  status: 'PENDING' | 'REJECTED';
  version: number;
  createdAt: string;
  animalCount: number;
  bodyHash: string;
  authorizationChallengeId: string;
  decidedAt?: string;
  decisionOperationId?: string;
  decisionExpectedVersion?: number;
};
export type TransferRequestItem = {
  _id: string;
  transferId: string;
  animalId: string;
  animalName: string;
  animalCode: string;
  expectedOwnerId: string;
  expectedOwnershipVersion: number;
  status: 'PENDING' | 'REJECTED';
};
export type RequestAnimal = Pick<
  TransferRequestItem,
  'animalId' | 'animalName' | 'animalCode' | 'expectedOwnershipVersion'
>;
export type TransferRequestSummary = Omit<
  TransferRequestRecord,
  | '_id'
  | 'bodyHash'
  | 'authorizationChallengeId'
  | 'decisionOperationId'
  | 'decisionExpectedVersion'
> & { id: string };
export type TransferRequestItemResponse = Pick<
  TransferRequestItem,
  'animalId' | 'animalName' | 'animalCode' | 'status'
> & { id: string };
export type RequestListAfter = { at: string; id: string };
export interface TransferRequestTransaction {
  session: ClientSession;
  find(id: string): Promise<TransferRequestRecord | null>;
  items(
    transferId: string,
    limit: number,
    afterAnimalId?: string,
  ): Promise<TransferRequestItem[]>;
  rejectAll(
    request: TransferRequestRecord,
    operationId: string,
    at: string,
  ): Promise<TransferRequestRecord>;
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
  ): Promise<TransferRequestRecord[]>;
  items(
    transferId: string,
    limit: number,
    afterAnimalId?: string,
  ): Promise<TransferRequestItem[]>;
}
