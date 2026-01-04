import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<UserEntity>;

@Schema({ collection: 'users' })
export class UserEntity {
    @Prop({ unique: true, required: true })
    id: string;

    @Prop()
    name: string;

    @Prop()
    identificationType: string;

    @Prop()
    identificationNumber: string;

    @Prop()
    country: string;

    @Prop()
    city: string;

    @Prop()
    email: string;

    @Prop()
    cellPhone: string;

    @Prop()
    professionalCard: string;

    @Prop({ type: [String] })
    animalTypes: string[];

    @Prop({ type: [String] })
    services: string[];

    @Prop()
    isHomeDelivery: boolean;

    @Prop()
    password?: string;
}

export const UserSchema = SchemaFactory.createForClass(UserEntity);
