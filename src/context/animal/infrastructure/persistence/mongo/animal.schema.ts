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

    @Prop()
    birthDate?: string;

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

    @Prop()
    housingType?: string;

    @Prop()
    purpose?: string;

    @Prop()
    feedingType?: string;

    @Prop()
    birthType?: string;

    @Prop()
    birthCondition?: string;

    @Prop()
    profilePictureUrl?: string;

    @Prop()
    createdAt?: string;

    @Prop()
    updatedAt?: string;

    @Prop()
    isAdopted?: boolean;

    @Prop()
    adoptionSource?: string;

    @Prop()
    adoptionPlaceName?: string;

    @Prop()
    identificationType?: string;

    @Prop()
    identificationNumber?: string;

    @Prop()
    registrationAssociation?: string;

    @Prop({ default: true })
    isActive: boolean;

    @Prop()
    nameUpdatedAt?: string;

    @Prop({ type: [{ name: String, date: String }], default: undefined })
    nameHistory?: Array<{ name: string; date: string }>;

    @Prop()
    unknownBirthDate?: boolean;

    @Prop()
    approximateAgeMinMonths?: number;

    @Prop()
    approximateAgeMaxMonths?: number;

    @Prop()
    otherDiagnosis?: boolean;

    @Prop()
    otherDiagnosisDetail?: string;

    @Prop()
    deactivationReason?: string;
}

export const AnimalSchema = SchemaFactory.createForClass(AnimalEntity);
