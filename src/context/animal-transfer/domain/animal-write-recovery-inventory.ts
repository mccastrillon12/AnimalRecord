import { AnimalOwnershipControl } from './animal-ownership';

export type WriteRecoveryObservation = {
  control: AnimalOwnershipControl;
  migrationLink: 'NOT_MIGRATION' | 'MATCHED' | 'MISSING' | 'MISMATCH';
  migration?: {
    id: string;
    animalId: string;
    ownerId: string;
    ownershipVersion: number;
    phase: string;
    revision: number;
    afterId?: string;
  };
};

/** Read-only observations, never evidence that an operation has died. */
export interface AnimalWriteRecoveryInventoryRepository {
  list(
    afterAnimalId: string | undefined,
    limit: number,
  ): Promise<WriteRecoveryObservation[]>;
}
