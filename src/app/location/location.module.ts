import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocationController } from './location.controller';
import { LocationFinder } from '../../context/location/application/location-finder';
import { LocationSeeder } from '../../context/location/application/location-seeder';
import { MongoLocationRepository } from '../../context/location/infrastructure/persistence/mongo/mongo-location-repository';
import { CountryEntity, CountrySchema, DepartmentEntity, DepartmentSchema, CityEntity, CitySchema } from '../../context/location/infrastructure/persistence/mongo/location.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: CountryEntity.name, schema: CountrySchema },
            { name: DepartmentEntity.name, schema: DepartmentSchema },
            { name: CityEntity.name, schema: CitySchema },
        ]),
    ],
    controllers: [LocationController],
    providers: [
        LocationFinder,
        LocationSeeder,
        {
            provide: 'LocationRepository',
            useClass: MongoLocationRepository
        }
    ]
})
export class LocationModule { }
