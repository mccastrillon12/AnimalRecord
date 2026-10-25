import { AnimalWriteRecoveryInventory } from '../../../src/context/animal-transfer/application/animal-write-recovery-inventory';
import {
  AnimalWriteRecoveryInventoryRepository,
  WriteRecoveryObservation,
} from '../../../src/context/animal-transfer/domain/animal-write-recovery-inventory';

const id = (number: number) =>
  `123e4567-e89b-42d3-a456-${String(number).padStart(12, '0')}`;
const observation = (number: number): WriteRecoveryObservation => ({
  control: {
    animalId: id(number),
    ownerId: id(100),
    ownershipVersion: 1,
    activeWrites: [{ token: 'unknown-operation', startedAt: '2000-01-01' }],
  },
  migrationLink: 'NOT_MIGRATION',
});

describe('Read-only recovery inventory', () => {
  const setup = (observations: WriteRecoveryObservation[] = []) => {
    const repository: jest.Mocked<AnimalWriteRecoveryInventoryRepository> = {
      list: jest.fn().mockResolvedValue(observations),
    };
    return {
      service: new AnimalWriteRecoveryInventory(repository),
      repository,
    };
  };

  it('bounds pages, uses one lookahead and returns an animal cursor without declaring old tokens dead', async () => {
    const ctx = setup([observation(1), observation(2), observation(3)]);
    expect(await ctx.service.list({ limit: 2 })).toEqual({
      items: [observation(1), observation(2)],
      nextAnimalId: id(2),
    });
    expect(ctx.repository.list.mock.calls).toEqual([[undefined, 3]]);
    expect(await ctx.service.list()).toEqual({
      items: [observation(1), observation(2), observation(3)],
    });
    expect(ctx.repository.list.mock.calls[1]).toEqual([undefined, 21]);
    expect(Object.keys(ctx.repository)).toEqual(['list']);
  });

  it('continues after a validated cursor and stops on an exact or empty page', async () => {
    const ctx = setup([observation(3)]);
    expect(await ctx.service.list({ afterAnimalId: id(2), limit: 1 })).toEqual({
      items: [observation(3)],
    });
    expect(ctx.repository.list.mock.calls[0]).toEqual([id(2), 2]);
    ctx.repository.list.mockResolvedValue([]);
    expect(await ctx.service.list()).toEqual({ items: [] });
  });

  it('rejects invalid limits/cursors before reading', async () => {
    const ctx = setup();
    for (const input of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { afterAnimalId: 'bad' },
    ])
      await expect(ctx.service.list(input)).rejects.toThrow(
        'Invalid recovery inventory',
      );
    expect(ctx.repository.list.mock.calls).toHaveLength(0);
  });

  it('rejects nonadvancing or over-limit pages and propagates read failures instead of returning a false empty inventory', async () => {
    const ctx = setup([observation(1), observation(1)]);
    await expect(ctx.service.list()).rejects.toThrow('cursor did not advance');
    ctx.repository.list.mockResolvedValue([
      observation(1),
      observation(2),
      observation(3),
    ]);
    await expect(ctx.service.list({ limit: 1 })).rejects.toThrow('exceeded');
    ctx.repository.list.mockRejectedValue(new Error('Primary unavailable'));
    await expect(ctx.service.list()).rejects.toThrow('Primary unavailable');
  });
});
