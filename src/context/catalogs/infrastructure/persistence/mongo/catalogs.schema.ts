import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SpeciesDocument = SpeciesEntity & Document;
export type BreedDocument = BreedEntity & Document;
export type HousingTypeDocument = HousingTypeEntity & Document;
export type AnimalPurposeDocument = AnimalPurposeEntity & Document;
export type TemperamentDocument = TemperamentEntity & Document;
export type AdoptionSourceDocument = AdoptionSourceEntity & Document;

@Schema({ collection: 'species' })
export class SpeciesEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;
}

@Schema({ collection: 'breeds' })
export class BreedEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true, index: true })
    speciesId: string;
}

@Schema({ collection: 'housing_types' })
export class HousingTypeEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;
}

@Schema({ collection: 'animal_purposes' })
export class AnimalPurposeEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;
}

@Schema({ collection: 'temperaments' })
export class TemperamentEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;
}

export const SpeciesSchema = SchemaFactory.createForClass(SpeciesEntity);
export const BreedSchema = SchemaFactory.createForClass(BreedEntity);
export const HousingTypeSchema = SchemaFactory.createForClass(HousingTypeEntity);
export const AnimalPurposeSchema = SchemaFactory.createForClass(AnimalPurposeEntity);
export const TemperamentSchema = SchemaFactory.createForClass(TemperamentEntity);

@Schema({ collection: 'adoption_sources' })
export class AdoptionSourceEntity {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    name: string;
}

export const AdoptionSourceSchema = SchemaFactory.createForClass(AdoptionSourceEntity);
