import { ConflictError } from '../../shared/domain/errors/ConflictError';

/** Missing means pre-protocol, never the same identity as persisted zero. */
export function reservationEpochMatch(value: number | undefined) {
  if (value === undefined) return { $exists: false };
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ConflictError('The animal reservation epoch is inconsistent');
  return value;
}

export function nextReservationEpoch(value: number | undefined): number {
  reservationEpochMatch(value);
  if (value !== undefined && value >= Number.MAX_SAFE_INTEGER)
    throw new ConflictError('The animal reservation epoch is exhausted');
  return (value ?? 0) + 1;
}

export function assertReservedEpoch(value: number | undefined): number {
  reservationEpochMatch(value);
  if (value === undefined || value < 1)
    throw new ConflictError('The reservation has no supported epoch identity');
  return value;
}
