import { MongoAnimalOwnerHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-owner-history';

function fixture() {
  const periods = [
    {
      animalId: 'animal',
      ownerId: 'owner1',
      ownershipVersion: 1,
      status: 'CLOSED',
      startedAtKnown: false,
      endedAt: '2026-11-17T12:00:00.000Z',
    },
    {
      animalId: 'animal',
      ownerId: 'owner2',
      ownershipVersion: 2,
      status: 'CLOSED',
      startedAtKnown: true,
      startedAt: '2026-11-17T12:00:00.000Z',
      endedAt: '2026-11-18T12:00:00.000Z',
      sourceTransferId: 'first',
    },
    {
      animalId: 'animal',
      ownerId: 'owner1',
      ownershipVersion: 3,
      status: 'ACTIVE',
      startedAtKnown: true,
      startedAt: '2026-11-18T12:00:00.000Z',
      sourceTransferId: 'return',
    },
  ];
  const requests = [
    {
      _id: 'first',
      senderId: 'owner1',
      senderName: 'Camila',
      recipientId: 'owner2',
      recipientName: 'Marc',
    },
    {
      _id: 'return',
      senderId: 'owner2',
      senderName: 'Marc',
      recipientId: 'owner1',
      recipientName: 'Camila',
    },
  ];
  const users = [
    { id: 'owner1', name: 'Nombre cambiado' },
    { id: 'owner2', name: 'Otro nombre' },
  ];
  const model = (rows: unknown[]) => ({
    find: jest.fn(() => {
      const query = {
        sort: () => query,
        select: () => query,
        lean: () => query,
        exec: () => Promise.resolve(rows),
      };
      return query;
    }),
  });
  const store = new MongoAnimalOwnerHistory(
    ...([
      model(periods),
      model(requests),
      model(users),
    ] as unknown as ConstructorParameters<typeof MongoAnimalOwnerHistory>),
  );
  return { store, periods };
}

it('returns one chronological entry per ownership period, including a return to the same owner', async () => {
  const { store } = fixture();
  const history = await store.read({ id: 'animal', ownerId: 'owner1' });
  expect(history.map((row) => row.ownerName)).toEqual([
    'Camila',
    'Marc',
    'Camila',
  ]);
  expect(history.map((row) => row.isCurrent)).toEqual([false, false, true]);
  expect(history[0]).not.toHaveProperty('startedAt');
  expect(history[0]).not.toHaveProperty('transferredAt');
  expect(history[2].transferredAt).toBe('2026-11-18T12:00:00.000Z');
});

it('cuts the former owner history at their closed period and denies an unrelated owner', async () => {
  const { store } = fixture();
  const history = await store.read({ id: 'animal', ownerId: 'owner2' }, 2);
  expect(history).toHaveLength(2);
  await expect(
    store.read({ id: 'animal', ownerId: 'stranger' }),
  ).rejects.toThrow('outside');
  await expect(
    store.read({ id: 'animal', ownerId: 'owner1' }, 2),
  ).rejects.toThrow('outside');
});

it('does not fabricate a first ownership period when persisted history is missing', async () => {
  const { store, periods } = fixture();
  periods.splice(0);
  await expect(
    store.read({
      id: 'animal',
      ownerId: 'owner1',
      createdAt: '2026-11-18T12:00:00.000Z',
    }),
  ).resolves.toEqual([]);
});
