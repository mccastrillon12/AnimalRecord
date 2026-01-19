import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AnimalDocument = HydratedDocument<AnimalEntity>;

@Schema({ collection: 'animals' })
export class AnimalEntity {
    @Prop({ unique: true, required: true })
    id: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    species: string;

    @Prop({ required: true })
    breed: string;

    @Prop({ required: true, unique: true })
    code: string;

    @Prop({ required: true })
    sex: string;

    @Prop({ required: true })
    reproductiveStatus: string;

    @Prop({ required: true })
    birthDate: string;

    @Prop({ required: true })
    hasChip: boolean;

    @Prop({ required: true })
    isAssociationMember: boolean;

    @Prop({ type: [String], required: true })
    temperament: string[];

    @Prop({ type: [String], required: true })
    diagnosis: string[];

    @Prop({ required: true })
    ownerId: string;

    @Prop()
    weight?: number;

    @Prop()
    colorAndMarkings?: string;

    @Prop()
    allergies?: string;
}

export const AnimalSchema = SchemaFactory.createForClass(AnimalEntity);
