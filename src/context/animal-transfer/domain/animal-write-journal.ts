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
export const ANIMAL_WRITE_PROTOCOL = 'TRANSACTIONAL_CLAIMS_V1' as const;
export type WriteJournalHandle = { id: string; instanceId: string };
export type WriteClaimState =
  | 'NOT_ATTEMPTED'
  | 'INTENT'
  | 'ACQUIRED'
  | 'NOT_ACQUIRED'
  | 'ACQUIRE_UNKNOWN'
  | 'RELEASED'
  | 'RELEASE_UNKNOWN'
  | 'RECOVERED';
export type WriteCallbackOutcome = 'RETURNED' | 'THREW' | 'NOT_INVOKED';
export const ANIMAL_WRITE_RECOVERY_REASONS = [
  'INSTANCE_TERMINATION_CONFIRMED',
  'OPERATOR_INTERVENTION',
] as const;
export type AnimalWriteRecoveryReason =
  (typeof ANIMAL_WRITE_RECOVERY_REASONS)[number];
export type AnimalWriteRecoveryRequest = {
  operationId: string;
  instanceId: string;
  requestId: string;
  operatorId: string;
  reason: AnimalWriteRecoveryReason;
  evidenceRef: string;
};
export type AnimalWriteRecoveryAudit = Omit<
  AnimalWriteRecoveryRequest,
  'operationId' | 'instanceId'
> & {
  recoveredAt: string;
  claims: Array<{
    animalId: string;
    previousState: Exclude<WriteClaimState, 'RECOVERED'>;
    tokenRemoved: boolean;
  }>;
};
export type AnimalWriteJournal = WriteJournalHandle & {
  // Absent on journals created before transactional acquisition; never backfill.
  protocol?: typeof ANIMAL_WRITE_PROTOCOL;
  actorId: string;
  kind: AnimalWriteKind;
  instanceStartedAt: string;
  createdAt: string;
  updatedAt: string;
  issuesUploadUrl: boolean;
  lifecycle: 'OPEN' | 'LOCALLY_FINISHED' | 'RECOVERED_BEFORE_CALLBACK';
  callback: 'NOT_STARTED' | 'MAY_RUN' | WriteCallbackOutcome;
  callbackPermittedAt?: string;
  callbackSettledAt?: string;
  coordinatorOutcome?: 'RETURNED' | 'THREW';
  coordinatorSettledAt?: string;
  recovery?: AnimalWriteRecoveryAudit;
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
    state: Exclude<WriteClaimState, 'NOT_ATTEMPTED' | 'RECOVERED'>,
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
