import { AnimalWriteJournalInventory } from '../../../src/context/animal-transfer/application/animal-write-journal-inventory';
import {
  AnimalWriteJournalInventoryRepository,
  AnimalWriteJournalObservation,
} from '../../../src/context/animal-transfer/domain/animal-write-journal-inventory';

const id = (number: number) =>
  `123e4567-e89b-42d3-a456-${String(number).padStart(12, '0')}`;
const animalId = id(100);
const observation = (number: number): AnimalWriteJournalObservation => ({
  operationId: id(number),
  instanceId: id(200),
  instanceStartedAt: '2026-10-25T00:00:00.000Z',
  createdAt: '2026-10-25T01:00:00.000Z',
  updatedAt: '2026-10-25T01:00:01.000Z',
  kind: 'ANIMAL_UPDATE',
  issuesUploadUrl: false,
  lifecycle: 'LOCALLY_FINISHED',
  callback: 'RETURNED',
  claim: {
    animalId,
    state: 'RELEASED',
    ownershipVersion: 1,
    updatedAt: '2026-10-25T01:00:01.000Z',
  },
});
const page = (items: AnimalWriteJournalObservation[]) => ({
  animalId,
  coverage: 'INCOMPLETE',
  remoteEffects: 'NOT_ASSESSED',
  items,
});
const setup = (rows: AnimalWriteJournalObservation[] = []) => {
  const repository: jest.Mocked<AnimalWriteJournalInventoryRepository> = {
    list: jest.fn().mockResolvedValue(rows),
  };
  return { service: new AnimalWriteJournalInventory(repository), repository };
};

describe('Internal journal inventory is incomplete local evidence', () => {
  it('uses default lookahead and never calls the write journal or ownership control', async () => {
    const ctx = setup([observation(1)]);
    expect(await ctx.service.list({ animalId })).toEqual(
      page([observation(1)]),
    );
    expect(ctx.repository.list.mock.calls[0]).toEqual([
      animalId,
      undefined,
      21,
    ]);
  });

  it('returns the last delivered operation as cursor, then an exact or empty page', async () => {
    const ctx = setup([observation(1), observation(2), observation(3)]);
    expect(await ctx.service.list({ animalId, limit: 2 })).toEqual({
      ...page([observation(1), observation(2)]),
      nextOperationId: id(2),
    });
    expect(ctx.repository.list.mock.calls[0]).toEqual([animalId, undefined, 3]);
    ctx.repository.list.mockResolvedValue([observation(3), observation(4)]);
    expect(
      await ctx.service.list({ animalId, afterOperationId: id(2), limit: 2 }),
    ).toEqual(page([observation(3), observation(4)]));
    expect(ctx.repository.list.mock.calls[1]).toEqual([animalId, id(2), 3]);
    ctx.repository.list.mockResolvedValue([]);
    expect(
      await ctx.service.list({ animalId, afterOperationId: id(4), limit: 50 }),
    ).toEqual(page([]));
    expect(ctx.repository.list.mock.calls[2]).toEqual([animalId, id(4), 51]);
  });

  it('keeps uncertain, recovered, terminal and legacy observations without inferring safety', async () => {
    const rows: AnimalWriteJournalObservation[] = [
      {
        ...observation(1),
        protocol: 'TRANSACTIONAL_CLAIMS_V1',
        lifecycle: 'OPEN',
        callback: 'MAY_RUN',
        callbackPermittedAt: '2026-10-25T01:00:00.000Z',
        claim: { ...observation(1).claim, state: 'ACQUIRE_UNKNOWN' },
      },
      {
        ...observation(2),
        callback: 'THREW',
        coordinatorOutcome: 'THREW',
      },
      {
        ...observation(3),
        lifecycle: 'RECOVERED_BEFORE_CALLBACK',
        callback: 'NOT_INVOKED',
        claim: { ...observation(3).claim, state: 'RECOVERED' },
      },
      {
        ...observation(4),
        kind: 'UNSPECIFIED',
        lifecycle: 'OPEN',
        callback: 'NOT_INVOKED',
        callbackPermittedAt: '2026-10-25T01:00:00.000Z',
        claim: { animalId, state: 'RELEASE_UNKNOWN', updatedAt: 'legacy-time' },
      },
    ];
    const ctx = setup(rows);
    const result = await ctx.service.list({ animalId });
    expect(result).toEqual(page(rows));
    expect(result.items[3]).not.toHaveProperty('protocol');
    expect(result.items[3].claim).not.toHaveProperty('ownershipVersion');
    expect(result).not.toHaveProperty('canCommit');
    expect(result).not.toHaveProperty('recoverable');
  });

  it.each([
    { animalId: 'bad' },
    { animalId, limit: 0 },
    { animalId, limit: 51 },
    { animalId, limit: 1.5 },
    { animalId, limit: Number.NaN },
    { animalId, afterOperationId: '' },
    { animalId, afterOperationId: 'not-an-id' },
    { animalId, limit: null },
    { animalId, afterOperationId: null },
    null,
  ])('rejects invalid input %j before reading', async (input) => {
    const ctx = setup();
    await expect(ctx.service.list(input as never)).rejects.toThrow(
      'Invalid journal inventory',
    );
    expect(ctx.repository.list.mock.calls).toHaveLength(0);
  });

  it.each([
    [observation(2), observation(1)],
    [observation(1), observation(1)],
    [{ ...observation(1), operationId: 'bad' }],
    [
      {
        ...observation(1),
        claim: { ...observation(1).claim, animalId: id(999) },
      },
    ],
    [
      {
        ...observation(1),
        claim: { ...observation(1).claim, ownershipVersion: 0 },
      },
    ],
  ])('rejects invalid repository order or scope %#', async (...rows) => {
    const ctx = setup(rows);
    await expect(ctx.service.list({ animalId })).rejects.toThrow(
      'Invalid journal inventory order or scope',
    );
  });

  it('checks the exclusive boundary, page size and scope of the lookahead row too', async () => {
    const ctx = setup([observation(2)]);
    await expect(
      ctx.service.list({ animalId, afterOperationId: id(2) }),
    ).rejects.toThrow('order or scope');
    ctx.repository.list.mockResolvedValue([
      observation(1),
      observation(2),
      observation(3),
    ]);
    await expect(ctx.service.list({ animalId, limit: 1 })).rejects.toThrow(
      'exceeded',
    );
    ctx.repository.list.mockResolvedValue([
      observation(1),
      {
        ...observation(2),
        claim: { ...observation(2).claim, animalId: id(999) },
      },
    ]);
    await expect(ctx.service.list({ animalId, limit: 1 })).rejects.toThrow(
      'order or scope',
    );
  });

  it('preserves read failures instead of claiming an empty inventory', async () => {
    const ctx = setup();
    const error = new Error('Primary unavailable');
    ctx.repository.list.mockRejectedValue(error);
    await expect(ctx.service.list({ animalId })).rejects.toBe(error);
  });
});
