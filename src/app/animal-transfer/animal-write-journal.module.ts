import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalWriteInstance } from '../../context/animal-transfer/application/animal-write-instance';
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
  ],
  exports: [AnimalWriteInstance, 'AnimalWriteJournal'],
})
export class AnimalWriteJournalModule {}
