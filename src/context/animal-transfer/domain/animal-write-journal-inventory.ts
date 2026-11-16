import { AnimalWriteJournal } from './animal-write-journal';

export type AnimalWriteJournalObservation = Pick<
  AnimalWriteJournal,
  | 'instanceId'
  | 'instanceStartedAt'
  | 'protocol'
  | 'kind'
  | 'issuesUploadUrl'
  | 'createdAt'
  | 'updatedAt'
  | 'lifecycle'
  | 'callback'
  | 'callbackPermittedAt'
  | 'callbackSettledAt'
  | 'coordinatorOutcome'
  | 'coordinatorSettledAt'
> & {
  operationId: string;
  claim: AnimalWriteJournal['claims'][number];
};

export type AnimalWriteJournalInventoryPage = {
  animalId: string;
  coverage: 'INCOMPLETE';
  remoteEffects: 'NOT_ASSESSED';
  items: AnimalWriteJournalObservation[];
  nextOperationId?: string;
};

/** Local observations only; neither absence nor terminal states prove remote closure. */
export interface AnimalWriteJournalInventoryRepository {
  list(
    animalId: string,
    afterOperationId: string | undefined,
    limit: number,
  ): Promise<AnimalWriteJournalObservation[]>;
}
