import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CountryDocument = CountryEntity & Document;
export type DepartmentDocument = DepartmentEntity & Document;
export type CityDocument = CityEntity & Document;

@Schema({ collection: 'countries' })
export class CountryEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    isoCode: string;

    @Prop({ required: true })
    dialCode: string;
}

@Schema({ collection: 'departments' })
export class DepartmentEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true, index: true })
    countryId: string;
}

@Schema({ collection: 'cities' })
export class CityEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true, index: true })
    departmentId: string;
}

export const CountrySchema = SchemaFactory.createForClass(CountryEntity);
export const DepartmentSchema = SchemaFactory.createForClass(DepartmentEntity);
export const CitySchema = SchemaFactory.createForClass(CityEntity);
