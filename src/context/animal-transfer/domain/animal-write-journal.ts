export const ANIMAL_WRITE_KINDS = [
  'UNSPECIFIED',
  'ANIMAL_UPDATE',
  'PROFILE_UPLOAD_URL',
  'PROFILE_CONFIRM',
  'DIARY_CREATE',
  'DIARY_UPDATE',
  'DIARY_DELETE',
  'ATTACHMENT_UPLOAD_URL',
  'ATTACHMENT_CONFIRM',
  'ATTACHMENT_DELETE',
  'MEDICAL_ANALYZE',
  'MEDICAL_POLL',
  'MEDICAL_REVIEW_ACCEPT',
  'MEDICAL_REVIEW_REJECT',
  'MEDICAL_REPLACEMENT_ANALYZE',
  'MEDICAL_REPLACEMENT_ACCEPT',
  'MEDICAL_REPLACEMENT_REJECT',
  'MEDICAL_DELETE',
  'MEDICAL_NORMALIZE_GROUP',
] as const;
export type AnimalWriteKind = (typeof ANIMAL_WRITE_KINDS)[number];
export type WriteJournalHandle = { id: string; instanceId: string };
export type WriteClaimState =
  | 'NOT_ATTEMPTED'
  | 'INTENT'
  | 'ACQUIRED'
  | 'NOT_ACQUIRED'
  | 'ACQUIRE_UNKNOWN'
  | 'RELEASED'
  | 'RELEASE_UNKNOWN';
export type WriteCallbackOutcome = 'RETURNED' | 'THREW' | 'NOT_INVOKED';
export type AnimalWriteJournal = WriteJournalHandle & {
  actorId: string;
  kind: AnimalWriteKind;
  instanceStartedAt: string;
  createdAt: string;
  updatedAt: string;
  issuesUploadUrl: boolean;
  lifecycle: 'OPEN' | 'LOCALLY_FINISHED';
  callback: 'NOT_STARTED' | 'MAY_RUN' | WriteCallbackOutcome;
  callbackPermittedAt?: string;
  callbackSettledAt?: string;
  coordinatorOutcome?: 'RETURNED' | 'THREW';
  coordinatorSettledAt?: string;
  claims: Array<{
    animalId: string;
    state: WriteClaimState;
    updatedAt: string;
    ownershipVersion?: number;
  }>;
};

export interface AnimalWriteJournalRepository {
  create(journal: AnimalWriteJournal): Promise<void>;
  find(id: string): Promise<AnimalWriteJournal | null>;
  claim(
    handle: WriteJournalHandle,
    animalId: string,
    state: Exclude<WriteClaimState, 'NOT_ATTEMPTED'>,
    at: string,
    ownershipVersion?: number,
  ): Promise<void>;
  permitCallback(handle: WriteJournalHandle, at: string): Promise<void>;
  settleCallback(
    handle: WriteJournalHandle,
    outcome: WriteCallbackOutcome,
    at: string,
  ): Promise<void>;
  finish(
    handle: WriteJournalHandle,
    outcome: 'RETURNED' | 'THREW',
    at: string,
  ): Promise<void>;
}
