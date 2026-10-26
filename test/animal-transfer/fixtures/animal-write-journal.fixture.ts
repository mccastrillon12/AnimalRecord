import { AnimalWriteInstance } from '../../../src/context/animal-transfer/application/animal-write-instance';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  AnimalWriteJournal,
  AnimalWriteJournalRepository,
  WriteJournalHandle,
} from '../../../src/context/animal-transfer/domain/animal-write-journal';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** In-memory protocol double. Mongo filters/majority are tested separately. */
export function createWriteJournalFixture() {
  const entries = new Map<string, AnimalWriteJournal>();
  const journal: jest.Mocked<AnimalWriteJournalRepository> = {
    create: jest.fn(),
    find: jest.fn(),
    claim: jest.fn(),
    permitCallback: jest.fn(),
    settleCallback: jest.fn(),
    finish: jest.fn(),
  };
  const instance: AnimalWriteInstance = {
    id: '123e4567-e89b-42d3-a456-426614174099',
    startedAt: '2026-10-25T00:00:00.000Z',
  };
  const get = (handle: WriteJournalHandle) => {
    const entry = entries.get(handle.id);
    if (
      !entry ||
      entry.instanceId !== handle.instanceId ||
      entry.lifecycle !== 'OPEN'
    )
      throw new ConflictError('Journal changed');
    return entry;
  };
  const reset = () => {
    entries.clear();
    journal.create.mockReset().mockImplementation((entry) => {
      if (entries.has(entry.id)) throw new ConflictError('Duplicate journal');
      entries.set(entry.id, clone(entry));
      return Promise.resolve();
    });
    journal.find
      .mockReset()
      .mockImplementation((id) =>
        Promise.resolve(clone(entries.get(id) ?? null)),
      );
    journal.claim
      .mockReset()
      .mockImplementation((handle, animalId, state, at, version) => {
        const entry = get(handle);
        const claim = entry.claims.find((item) => item.animalId === animalId);
        const previous = {
          INTENT: ['NOT_ATTEMPTED'],
          ACQUIRED: ['ACQUIRED'],
          NOT_ACQUIRED: ['INTENT'],
          ACQUIRE_UNKNOWN: ['INTENT'],
          RELEASED: ['INTENT', 'ACQUIRED'],
          RELEASE_UNKNOWN: ['INTENT', 'ACQUIRED'],
        };
        if (!claim || !previous[state].includes(claim.state))
          throw new ConflictError('Journal changed');
        claim.state = state;
        claim.updatedAt = at;
        entry.updatedAt = at;
        if (state === 'INTENT') claim.ownershipVersion = version;
        return Promise.resolve();
      });
    journal.permitCallback.mockReset().mockImplementation((handle, at) => {
      const entry = get(handle);
      if (
        entry.callback !== 'NOT_STARTED' ||
        entry.claims.some((c) => c.state !== 'ACQUIRED')
      )
        throw new ConflictError('Journal changed');
      entry.callback = 'MAY_RUN';
      entry.callbackPermittedAt = at;
      return Promise.resolve();
    });
    journal.settleCallback
      .mockReset()
      .mockImplementation((handle, outcome, at) => {
        const entry = get(handle);
        if (
          entry.callback !== 'MAY_RUN' &&
          !(outcome === 'NOT_INVOKED' && entry.callback === 'NOT_STARTED')
        )
          throw new ConflictError('Journal changed');
        entry.callback = outcome;
        entry.callbackSettledAt = at;
        return Promise.resolve();
      });
    journal.finish.mockReset().mockImplementation((handle, outcome, at) => {
      const entry = get(handle);
      if (!['RETURNED', 'THREW', 'NOT_INVOKED'].includes(entry.callback))
        throw new ConflictError('Journal changed');
      entry.coordinatorOutcome = outcome;
      entry.coordinatorSettledAt = at;
      if (
        entry.claims.every((c) =>
          ['NOT_ATTEMPTED', 'NOT_ACQUIRED', 'RELEASED'].includes(c.state),
        )
      )
        entry.lifecycle = 'LOCALLY_FINISHED';
      return Promise.resolve();
    });
  };
  reset();
  const acquire = async (
    input: Parameters<AnimalOwnershipRepository['beginWrite']>[0],
    operation: () => Promise<boolean>,
  ) => {
    const acquired = await operation();
    if (acquired && input.journal) {
      const entry = get({
        id: input.journal.operationId,
        instanceId: input.journal.instanceId,
      });
      const claim = entry.claims.find((c) => c.animalId === input.animalId);
      if (
        !claim ||
        claim.state !== 'INTENT' ||
        entry.callback !== 'NOT_STARTED'
      )
        throw new ConflictError('Journal changed');
      claim.state = 'ACQUIRED';
    }
    return acquired;
  };
  return { journal, instance, entries, reset, acquire };
}

/** Keep configurable acquisition mocks while representing the joint commit. */
export function withJournalAcquisition<
  T extends Pick<AnimalOwnershipRepository, 'beginWrite'>,
>(ownership: T, fixture: ReturnType<typeof createWriteJournalFixture>): T {
  return {
    ...ownership,
    beginWrite: (input) =>
      fixture.acquire(input, () => ownership.beginWrite(input)),
  };
}
