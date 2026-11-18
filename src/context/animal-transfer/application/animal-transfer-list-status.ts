export const ANIMAL_TRANSFER_LIST_STATUS = Symbol('AnimalTransferListStatus');

export type LiveAnimalTransferStatus = 'PENDING' | 'PROCESSING';

export interface AnimalTransferListStatus {
  /** Input is the current user's owned animals from the list being rendered. */
  read(
    animalIds: readonly string[],
  ): Promise<Map<string, LiveAnimalTransferStatus>>;
}
