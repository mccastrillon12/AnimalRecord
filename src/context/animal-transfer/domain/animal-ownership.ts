export enum OwnershipPeriodStartProvenance {
  Created = 'CREATED',
  InferredFromAnimalCreation = 'INFERRED_FROM_ANIMAL_CREATION',
  Unknown = 'UNKNOWN',
  Transfer = 'TRANSFER',
}

export type EnsureAnimalOwnershipInput = {
  animalId: string;
  ownerId: string;
  startedAt?: string;
  startProvenance: OwnershipPeriodStartProvenance;
};

export type AnimalTransferLock = {
  transferId: string;
  lockedAt: string;
};

export type AnimalOwnershipControl = {
  animalId: string;
  ownerId: string;
  ownershipVersion: number;
  transferLock?: AnimalTransferLock;
  activeWrites?: Array<{ token: string; startedAt: string }>;
  uploadsValidUntil?: string;
};

export interface AnimalOwnershipRepository {
  listAnimalsForInitialization(
    afterId: string | undefined,
    limit: number,
  ): Promise<Array<{ id: string; ownerId: string; createdAt?: string }>>;
  ensureCurrentOwnership(input: EnsureAnimalOwnershipInput): Promise<void>;
  findControl(animalId: string): Promise<AnimalOwnershipControl | null>;
  beginWrite(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    token: string;
    startedAt: string;
  }): Promise<boolean>;
  endWrite(animalId: string, token: string): Promise<void>;
  recordUploadWindow(
    animalId: string,
    token: string,
    validUntil: string,
  ): Promise<boolean>;
  acquireTransferLock(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    transferId: string;
    lockedAt: string;
  }): Promise<boolean>;
  releaseTransferLock(animalId: string, transferId: string): Promise<boolean>;
}
