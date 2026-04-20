import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogsController } from './catalogs.controller';
import { CatalogsFinder } from '../../context/catalogs/application/catalogs-finder';
import { CatalogsSeeder } from '../../context/catalogs/application/catalogs-seeder';
import { MongoCatalogsRepository } from '../../context/catalogs/infrastructure/persistence/mongo/mongo-catalogs-repository';
import {
    SpeciesEntity, SpeciesSchema,
    BreedEntity, BreedSchema,
    HousingTypeEntity, HousingTypeSchema,
    AnimalPurposeEntity, AnimalPurposeSchema,
    TemperamentEntity, TemperamentSchema
} from '../../context/catalogs/infrastructure/persistence/mongo/catalogs.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: SpeciesEntity.name, schema: SpeciesSchema },
            { name: BreedEntity.name, schema: BreedSchema },
            { name: HousingTypeEntity.name, schema: HousingTypeSchema },
            { name: AnimalPurposeEntity.name, schema: AnimalPurposeSchema },
            { name: TemperamentEntity.name, schema: TemperamentSchema },
        ]),
    ],
    controllers: [CatalogsController],
    providers: [
        CatalogsFinder,
        CatalogsSeeder,
        {
            provide: 'CatalogsRepository',
            useClass: MongoCatalogsRepository
        }
    ]
})
export class CatalogsModule { }
