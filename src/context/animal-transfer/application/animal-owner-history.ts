export type AnimalOwnerHistoryEntry = Readonly<{
  ownerId: string;
  ownerName?: string;
  ownershipVersion: number;
  startedAt?: string;
  transferredAt?: string;
  endedAt?: string;
  isCurrent: boolean;
}>;
export const ANIMAL_OWNER_HISTORY = Symbol('AnimalOwnerHistory');
export interface AnimalOwnerHistory {
  read(
    animal: { id: string; ownerId: string; createdAt?: string },
    throughVersion?: number,
  ): Promise<readonly AnimalOwnerHistoryEntry[]>;
}
