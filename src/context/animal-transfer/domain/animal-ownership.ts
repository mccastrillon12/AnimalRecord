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
};

export interface AnimalOwnershipRepository {
  listAnimalsForInitialization(
    afterId: string | undefined,
    limit: number,
  ): Promise<Array<{ id: string; ownerId: string; createdAt?: string }>>;
  ensureCurrentOwnership(input: EnsureAnimalOwnershipInput): Promise<void>;
  findControl(animalId: string): Promise<AnimalOwnershipControl | null>;
  acquireTransferLock(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    transferId: string;
    lockedAt: string;
  }): Promise<boolean>;
  releaseTransferLock(animalId: string, transferId: string): Promise<boolean>;
}
