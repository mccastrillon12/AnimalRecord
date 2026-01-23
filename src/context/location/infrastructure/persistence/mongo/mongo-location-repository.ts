import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LocationRepository } from '../../../domain/location-repository';
import { Country, Department, City } from '../../../domain/location';
import { CountryDocument, DepartmentDocument, CityDocument, CountryEntity, DepartmentEntity, CityEntity } from './location.schema';

@Injectable()
export class MongoLocationRepository implements LocationRepository {
    constructor(
        @InjectModel(CountryEntity.name) private countryModel: Model<CountryDocument>,
        @InjectModel(DepartmentEntity.name) private departmentModel: Model<DepartmentDocument>,
        @InjectModel(CityEntity.name) private cityModel: Model<CityDocument>,
    ) { }

    async findAllCountries(): Promise<Country[]> {
        const docs = await this.countryModel.find().exec();
        return docs.map(d => new Country(d._id, d.name, d.isoCode, d.dialCode));
    }

    async findByIsoCode(isoCode: string): Promise<Country | null> {
        const doc = await this.countryModel.findOne({ isoCode }).exec();
        return doc ? new Country(doc._id, doc.name, doc.isoCode, doc.dialCode) : null;
    }

    async findDepartmentsByCountry(countryId: string): Promise<Department[]> {
        const docs = await this.departmentModel.find({ countryId }).exec();
        return docs.map(d => new Department(d._id, d.name, d.countryId));
    }

    async findCitiesByDepartment(departmentId: string): Promise<City[]> {
        const docs = await this.cityModel.find({ departmentId }).exec();
        return docs.map(d => new City(d._id, d.name, d.departmentId));
    }

    async saveCountry(country: Country): Promise<void> {
        await this.countryModel.updateOne(
            { _id: country.id },
            { name: country.name, isoCode: country.isoCode, dialCode: country.dialCode },
            { upsert: true }
        ).exec();
    }

    async saveDepartment(department: Department): Promise<void> {
        await this.departmentModel.create({ _id: department.id, name: department.name, countryId: department.countryId });
    }

    async saveCity(city: City): Promise<void> {
        await this.cityModel.create({ _id: city.id, name: city.name, departmentId: city.departmentId });
    }

    async countCountries(): Promise<number> {
        return this.countryModel.countDocuments().exec();
    }
}
