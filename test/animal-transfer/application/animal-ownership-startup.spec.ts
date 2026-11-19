import { Global, Logger, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Schema } from 'mongoose';
import { CatalogsModule } from '../../../src/app/catalogs/catalogs.module';
import { CatalogsFinder } from '../../../src/context/catalogs/application/catalogs-finder';
import { AnimalOwnershipInitializer } from '../../../src/context/animal-transfer/application/animal-ownership-initializer';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';

type Seed = {
  _id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

it('completes Nest startup and seeds both catalogues even when an unrelated animal period is inconsistent', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const info = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  const data = new Map<string, Map<string, Seed>>();
  const models: Record<string, unknown> = {};
  const connection = {
    models,
    model(name: string, schema: Schema) {
      const collection = schema.get('collection') as string;
      const rows = new Map<string, Seed>();
      data.set(collection, rows);
      const model = {
        findOne: (filter: Record<string, string>) => ({
          exec: () =>
            Promise.resolve({ _id: 'existing-' + filter.name, ...filter }),
        }),
        updateOne: (
          filter: { code: string },
          update: { $setOnInsert: Seed },
        ) => ({
          exec: () => {
            if (!rows.has(filter.code))
              rows.set(filter.code, structuredClone(update.$setOnInsert));
            return Promise.resolve({ acknowledged: true });
          },
        }),
        find: () => {
          const query = {
            sort: () => query,
            lean: () => query,
            exec: () =>
              Promise.resolve([...rows.values()].filter((row) => row.isActive)),
          };
          return query;
        },
      };
      models[name] = model;
      return model;
    },
  };
  const ensureCurrentOwnership = jest
    .fn()
    .mockRejectedValueOnce(
      new ConflictError('The animal ownership period is inconsistent'),
    )
    .mockResolvedValue(undefined);
  const listAnimalsForInitialization = jest
    .fn()
    .mockResolvedValueOnce([
      { id: 'broken-animal', ownerId: 'owner' },
      { id: 'healthy-animal', ownerId: 'owner' },
    ])
    .mockResolvedValueOnce([]);

  @Global()
  @Module({
    providers: [{ provide: getConnectionToken(), useValue: connection }],
    exports: [getConnectionToken()],
  })
  class SimulatedDatabase {}

  @Module({
    providers: [
      AnimalOwnershipInitializer,
      {
        provide: 'AnimalOwnershipRepository',
        useValue: { ensureCurrentOwnership, listAnimalsForInitialization },
      },
    ],
  })
  class OwnershipBootstrap {}

  const app = await Test.createTestingModule({
    imports: [SimulatedDatabase, OwnershipBootstrap, CatalogsModule],
  }).compile();
  try {
    await expect(app.init()).resolves.toBeDefined();
    expect(ensureCurrentOwnership).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith({
      event: 'animal-ownership-initialization-conflict',
      animalId: 'broken-animal',
    });
    const catalogue = app.get(CatalogsFinder);
    expect(await catalogue.findAnimalTransferReasons()).toHaveLength(5);
    expect(await catalogue.findAnimalTransferRejectionReasons()).toHaveLength(
      3,
    );
    expect(data.get('animal_transfer_reasons')?.size).toBe(5);
    expect(data.get('animal_transfer_rejection_reasons')?.size).toBe(3);
    expect(log).toHaveBeenCalledWith('Catalogs seeded successfully!');
  } finally {
    await app.close();
    log.mockRestore();
    warn.mockRestore();
    info.mockRestore();
  }
});
