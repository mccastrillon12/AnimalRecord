import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalWriteInstance } from '../../context/animal-transfer/application/animal-write-instance';
import { AnimalWriteJournalInventory } from '../../context/animal-transfer/application/animal-write-journal-inventory';
import { MongoAnimalWriteJournalInventory } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal-inventory';
import {
  ANIMAL_WRITE_JOURNAL_MODEL,
  AnimalWriteJournalSchema,
  MongoAnimalWriteJournal,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ANIMAL_WRITE_JOURNAL_MODEL, schema: AnimalWriteJournalSchema },
    ]),
  ],
  providers: [
    AnimalWriteInstance,
    { provide: 'AnimalWriteJournal', useClass: MongoAnimalWriteJournal },
    {
      provide: 'AnimalWriteJournalInventoryRepository',
      useClass: MongoAnimalWriteJournalInventory,
    },
    AnimalWriteJournalInventory,
  ],
  exports: [
    MongooseModule,
    AnimalWriteInstance,
    'AnimalWriteJournal',
    AnimalWriteJournalInventory,
  ],
})
export class AnimalWriteJournalModule {}
