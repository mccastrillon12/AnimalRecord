import { Global, Injectable, Module } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AnimalWriteJournalModule } from '../../../src/app/animal-transfer/animal-write-journal.module';
import { AnimalWriteRecovery } from '../../../src/context/animal-transfer/application/animal-write-recovery';
import { AnimalWriteJournalInventory } from '../../../src/context/animal-transfer/application/animal-write-journal-inventory';
import { AnimalEntity } from '../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { ANIMAL_WRITE_JOURNAL_MODEL } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';

@Global()
@Module({
  providers: [
    {
      provide: getConnectionToken(),
      useValue: { models: { [ANIMAL_WRITE_JOURNAL_MODEL]: {} } },
    },
  ],
  exports: [getConnectionToken()],
})
class SimulatedConnectionModule {}

@Injectable()
class JournalInventoryConsumer {
  constructor(readonly inventory: AnimalWriteJournalInventory) {}
}

@Module({
  imports: [AnimalWriteJournalModule],
  providers: [
    AnimalWriteRecovery,
    JournalInventoryConsumer,
    {
      provide: 'AnimalOwnershipRepository',
      useClass: MongoAnimalOwnershipRepository,
    },
    ...[
      AnimalEntity.name,
      AnimalOwnershipControlEntity.name,
      AnimalOwnershipPeriodEntity.name,
    ].map((name) => ({ provide: getModelToken(name), useValue: {} })),
  ],
})
class OwnershipConsumerModule {}

it('exports the journal model to the ownership consumer without opening Mongo connections', async () => {
  const module = await Test.createTestingModule({
    imports: [SimulatedConnectionModule, OwnershipConsumerModule],
  }).compile();
  expect(module.get(AnimalWriteRecovery)).toBeInstanceOf(AnimalWriteRecovery);
  expect(module.get('AnimalOwnershipRepository')).toBeInstanceOf(
    MongoAnimalOwnershipRepository,
  );
  expect(module.get(JournalInventoryConsumer).inventory).toBeInstanceOf(
    AnimalWriteJournalInventory,
  );
  await module.close();
});
