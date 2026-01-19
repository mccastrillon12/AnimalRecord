import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalEntity, AnimalSchema } from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import { MongoAnimalRepository } from '../../context/animal/infrastructure/persistence/mongo/mongo-animal-repository';
import { AnimalCreator } from '../../context/animal/application/creator/animal-creator';
import { AnimalFinder } from '../../context/animal/application/finder/animal-finder';
import { AnimalFinderAll } from '../../context/animal/application/finder-all/animal-finder-all';
import { AnimalUpdater } from '../../context/animal/application/updater/animal-updater';
import { AnimalController } from './animal.controller';
import { CounterEntity, CounterSchema } from '../../context/shared/infrastructure/persistence/mongo/counter.schema';
import { MongoCounterRepository } from '../../context/shared/infrastructure/persistence/mongo/mongo-counter-repository';
import { AnimalCodeGenerator } from '../../context/animal/application/generators/animal-code-generator';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: AnimalEntity.name, schema: AnimalSchema },
            { name: CounterEntity.name, schema: CounterSchema }
        ])
    ],
    controllers: [AnimalController],
    providers: [
        {
            provide: 'AnimalRepository',
            useClass: MongoAnimalRepository
        },
        AnimalCreator,
        AnimalFinder,
        AnimalFinderAll,
        AnimalUpdater,
        MongoCounterRepository,
        AnimalCodeGenerator
    ],
    exports: [
        AnimalCreator,
        AnimalFinder,
        AnimalFinderAll,
        AnimalUpdater,
        'AnimalRepository'
    ]
})
export class AnimalModule { }
