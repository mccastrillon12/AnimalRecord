import { MongoAnimalWriteJournalInventory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal-inventory';
import { AnimalWriteJournalSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';

const id = (number: number) =>
  `123e4567-e89b-42d3-a456-${String(number).padStart(12, '0')}`;
const animalId = id(100);
const journal = (): AnimalWriteJournal => ({
  id: id(1),
  instanceId: id(200),
  instanceStartedAt: '2026-10-25T00:00:00.000Z',
  actorId: id(300),
  protocol: 'TRANSACTIONAL_CLAIMS_V1',
  kind: 'PROFILE_CONFIRM',
  issuesUploadUrl: false,
  createdAt: '2026-10-25T01:00:00.000Z',
  updatedAt: '2026-10-25T01:00:01.000Z',
  lifecycle: 'LOCALLY_FINISHED',
  callback: 'RETURNED',
  callbackPermittedAt: '2026-10-25T01:00:00.000Z',
  callbackSettledAt: '2026-10-25T01:00:01.000Z',
  coordinatorOutcome: 'RETURNED',
  coordinatorSettledAt: '2026-10-25T01:00:01.000Z',
  claims: [
    {
      animalId,
      state: 'RELEASED',
      ownershipVersion: 1,
      updatedAt: 'claim-time',
    },
  ],
});
const setup = (rows: unknown[] = [journal()]) => {
  const read = {
    select: jest.fn<unknown, [Record<string, unknown>]>(),
    collation: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    maxTimeMS: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(rows),
  };
  for (const [method, mock] of Object.entries(read))
    if (method !== 'exec') mock.mockReturnValue(read);
  const model = { find: jest.fn().mockReturnValue(read) };
  return {
    repository: new MongoAnimalWriteJournalInventory(model as never),
    model,
    read,
  };
};

describe('Mongo journal inventory (simulated model)', () => {
  it('reads a bounded primary/majority page by animal and operation with no status, version, age or token predicate', async () => {
    const ctx = setup();
    await ctx.repository.list(animalId, id(0), 51);
    expect(ctx.model.find).toHaveBeenCalledWith({
      'claims.animalId': animalId,
      id: { $gt: id(0) },
    });
    expect(ctx.read.sort).toHaveBeenCalledWith({ id: 1 });
    expect(ctx.read.collation).toHaveBeenCalledWith({ locale: 'simple' });
    expect(ctx.read.limit).toHaveBeenCalledWith(51);
    expect(ctx.read.read).toHaveBeenCalledWith('primary');
    expect(ctx.read.readConcern).toHaveBeenCalledWith('majority');
    expect(ctx.read.maxTimeMS).toHaveBeenCalledWith(5000);
    const projection = ctx.read.select.mock.calls[0][0];
    expect(projection).toEqual(
      expect.objectContaining({ id: 1, claims: 1, callbackPermittedAt: 1 }),
    );
    for (const field of ['actorId', 'recovery', 'payload', 'error', '__v'])
      expect(projection).not.toHaveProperty(field);
  });

  it('rebuilds a scoped allowlist even if the model supplies unexpected or other-animal fields', async () => {
    const row = {
      ...journal(),
      recovery: { evidenceRef: 'incident:private' },
      payload: { clinical: 'private' },
      claims: [
        { animalId: id(999), state: 'ACQUIRED', updatedAt: 'other' },
        { ...journal().claims[0], secret: 'private' },
      ],
    };
    const before = JSON.stringify(row);
    const ctx = setup([row]);
    const result = await ctx.repository.list(animalId, undefined, 21);
    expect(ctx.model.find).toHaveBeenCalledWith({
      'claims.animalId': animalId,
    });
    expect(result).toEqual([
      {
        operationId: id(1),
        instanceId: id(200),
        instanceStartedAt: row.instanceStartedAt,
        protocol: row.protocol,
        kind: 'PROFILE_CONFIRM',
        issuesUploadUrl: false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lifecycle: 'LOCALLY_FINISHED',
        callback: 'RETURNED',
        callbackPermittedAt: row.callbackPermittedAt,
        callbackSettledAt: row.callbackSettledAt,
        coordinatorOutcome: 'RETURNED',
        coordinatorSettledAt: row.coordinatorSettledAt,
        claim: journal().claims[0],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain(id(999));
    expect(JSON.stringify(result)).not.toContain(id(300));
    expect(JSON.stringify(row)).toBe(before);
  });

  it('preserves legacy absence, unknown claims and a NOT_INVOKED callback that had permission', async () => {
    const legacy = journal();
    delete legacy.protocol;
    delete legacy.claims[0].ownershipVersion;
    legacy.lifecycle = 'OPEN';
    legacy.kind = 'UNSPECIFIED';
    legacy.callback = 'NOT_INVOKED';
    legacy.claims[0].state = 'RELEASE_UNKNOWN';
    const ctx = setup([legacy]);
    const [row] = await ctx.repository.list(animalId, undefined, 21);
    expect(row).not.toHaveProperty('protocol');
    expect(row.claim).not.toHaveProperty('ownershipVersion');
    expect(row).toMatchObject({
      kind: 'UNSPECIFIED',
      lifecycle: 'OPEN',
      callback: 'NOT_INVOKED',
      callbackPermittedAt: legacy.callbackPermittedAt,
      claim: { state: 'RELEASE_UNKNOWN' },
    });
  });

  it.each([
    { claims: [] },
    { claims: [{ ...journal().claims[0], animalId: id(999) }] },
    { claims: [journal().claims[0], journal().claims[0]] },
    { claims: undefined },
  ])('rejects missing or duplicate matching claims %#', async ({ claims }) => {
    const ctx = setup([{ ...journal(), claims }]);
    await expect(ctx.repository.list(animalId, undefined, 21)).rejects.toThrow(
      'Invalid journal inventory claims',
    );
  });

  it.each([0, 52, 1.5, Number.NaN])(
    'rejects invalid query limit %s',
    async (limit) => {
      const ctx = setup();
      await expect(
        ctx.repository.list(animalId, undefined, limit),
      ).rejects.toThrow('Invalid journal inventory query');
      expect(ctx.model.find).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid scope/cursor and propagates timeouts without fallback or writes', async () => {
    const ctx = setup();
    await expect(ctx.repository.list('bad', undefined, 21)).rejects.toThrow(
      'Invalid journal inventory query',
    );
    await expect(ctx.repository.list(animalId, 'bad', 21)).rejects.toThrow(
      'Invalid journal inventory query',
    );
    expect(ctx.model.find).not.toHaveBeenCalled();
    const error = Object.assign(new Error('Exceeded time limit'), { code: 50 });
    ctx.read.exec.mockRejectedValue(error);
    await expect(ctx.repository.list(animalId, undefined, 21)).rejects.toBe(
      error,
    );
    expect(ctx.model.find).toHaveBeenCalledTimes(1);
    ctx.read.exec.mockResolvedValue([]);
    expect(await ctx.repository.list(animalId, undefined, 21)).toEqual([]);
  });

  it('leaves existing index declarations unchanged, without adding startup index construction', () => {
    expect(
      AnimalWriteJournalSchema.indexes().map(([fields]) => fields),
    ).toEqual([{ id: 1 }, { instanceId: 1, lifecycle: 1 }]);
  });
});
