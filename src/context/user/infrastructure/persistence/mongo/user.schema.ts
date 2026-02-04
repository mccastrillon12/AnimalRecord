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
    department: string;

    @Prop()
    city: string;

    @Prop()
    address: string;

    @Prop()
    email: string;

    @Prop({ required: false })
    cellPhone?: string;

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

    @Prop()
    refreshToken?: string;

    @Prop({ type: [String], default: [] })
    roles: string[];

    @Prop({ type: Boolean, default: false })
    isVerified: boolean;

    @Prop()
    verificationCode?: string;

    @Prop()
    verificationCodeExpiration?: Date;

    @Prop({ required: true, default: 'EMAIL' })
    authMethod: string;

    @Prop({ required: false, sparse: true })
    googleId?: string;

    @Prop({ required: false, sparse: true })
    appleId?: string;

    @Prop({ required: false, sparse: true })
    microsoftId?: string;

    @Prop({ required: false })
    resetPasswordCode?: string;

    @Prop({ required: false })
    resetPasswordExpiration?: Date;
}

export const UserSchema = SchemaFactory.createForClass(UserEntity);
