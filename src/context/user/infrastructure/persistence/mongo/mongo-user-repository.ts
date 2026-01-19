import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRepository } from '../../../domain/userRepository';
import { User } from '../../../domain/user';
import { UserRole } from '../../../domain/userRole';
import { UserEntity, UserDocument } from './user.schema';
import { Nullable } from '../../../../shared/domain/Nullable';
import { Uuid } from '../../../../shared/domain/value-object/Uuid';
import { UserId } from '../../../domain/userId';
import { UserName } from '../../../domain/userName';
import { UserIdentificationType } from '../../../domain/userIdentificationType';
import { UserIdentificationNumber } from '../../../domain/userIdentificationNumber';
import { UserCountry } from '../../../domain/userCountry';
import { UserCity } from '../../../domain/userCity';
import { UserEmail } from '../../../domain/userEmail';
import { UserCellPhone } from '../../../domain/userCellPhone';
import { UserProfessionalCard } from '../../../domain/userProfessionalCard';
import { UserAnimalTypes } from '../../../domain/userAnimalTypes';
import { UserServices } from '../../../domain/userServices';
import { UserIsHomeDelivery } from '../../../domain/userIsHomeDelivery';

@Injectable()
export class MongoUserRepository implements UserRepository {
    constructor(
        @InjectModel(UserEntity.name) private userModel: Model<UserDocument>
    ) { }

    async insert(user: User): Promise<User> {
        const primitives = user.toPrimitives();
        const createdUser = new this.userModel(primitives);
        await createdUser.save();
        return user;
    }

    async findById(id: Uuid): Promise<Nullable<User>> {
        const user = await this.userModel.findOne({ id: id.value }).exec();
        if (!user) return null;

        return new User(
            new UserId(user.id),
            new UserName(user.name),
            new UserIdentificationType(user.identificationType),
            new UserIdentificationNumber(user.identificationNumber),
            new UserCountry(user.country),
            user.city ? new UserCity(user.city) : undefined,
            user.email ? new UserEmail(user.email) : undefined,
            user.cellPhone ? new UserCellPhone(user.cellPhone) : undefined,
            user.professionalCard ? new UserProfessionalCard(user.professionalCard) : undefined,
            user.animalTypes ? new UserAnimalTypes(user.animalTypes) : undefined,
            user.services ? new UserServices(user.services) : undefined,
            user.isHomeDelivery !== undefined ? new UserIsHomeDelivery(user.isHomeDelivery) : undefined,
            (user.roles || []).map(role => new UserRole(role)),
            user.password,
            user.refreshToken
        );
    }

    async findAll(): Promise<User[]> {
        const users = await this.userModel.find().exec();
        return users.map(user => new User(
            new UserId(user.id),
            new UserName(user.name),
            new UserIdentificationType(user.identificationType),
            new UserIdentificationNumber(user.identificationNumber),
            new UserCountry(user.country),
            user.city ? new UserCity(user.city) : undefined,
            user.email ? new UserEmail(user.email) : undefined,
            user.cellPhone ? new UserCellPhone(user.cellPhone) : undefined,
            user.professionalCard ? new UserProfessionalCard(user.professionalCard) : undefined,
            user.animalTypes ? new UserAnimalTypes(user.animalTypes) : undefined,
            user.services ? new UserServices(user.services) : undefined,
            user.isHomeDelivery !== undefined ? new UserIsHomeDelivery(user.isHomeDelivery) : undefined,
            (user.roles || []).map(role => new UserRole(role)),
            user.password,
            user.refreshToken
        ));
    }

    async update(user: User): Promise<boolean> {
        const primitiveData = user.toPrimitives();
        const result = await this.userModel.updateOne({ id: primitiveData.id }, primitiveData).exec();
        return result.modifiedCount > 0;
    }

    async findByEmail(email: string): Promise<User | null> {
        const user = await this.userModel.findOne({ email }).exec();
        return user ? new User(
            new UserId(user.id),
            new UserName(user.name),
            new UserIdentificationType(user.identificationType),
            new UserIdentificationNumber(user.identificationNumber),
            new UserCountry(user.country),
            user.city ? new UserCity(user.city) : undefined,
            user.email ? new UserEmail(user.email) : undefined,
            user.cellPhone ? new UserCellPhone(user.cellPhone) : undefined,
            user.professionalCard ? new UserProfessionalCard(user.professionalCard) : undefined,
            user.animalTypes ? new UserAnimalTypes(user.animalTypes) : undefined,
            user.services ? new UserServices(user.services) : undefined,
            user.isHomeDelivery !== undefined ? new UserIsHomeDelivery(user.isHomeDelivery) : undefined,
            (user.roles || []).map(role => new UserRole(role)),
            user.password,
            user.refreshToken
        ) : null;
    }

    async findByCellPhone(cellPhone: string): Promise<User | null> {
        const user = await this.userModel.findOne({ cellPhone }).exec();
        return user ? new User(
            new UserId(user.id),
            new UserName(user.name),
            new UserIdentificationType(user.identificationType),
            new UserIdentificationNumber(user.identificationNumber),
            new UserCountry(user.country),
            user.city ? new UserCity(user.city) : undefined,
            user.email ? new UserEmail(user.email) : undefined,
            user.cellPhone ? new UserCellPhone(user.cellPhone) : undefined,
            user.professionalCard ? new UserProfessionalCard(user.professionalCard) : undefined,
            user.animalTypes ? new UserAnimalTypes(user.animalTypes) : undefined,
            user.services ? new UserServices(user.services) : undefined,
            user.isHomeDelivery !== undefined ? new UserIsHomeDelivery(user.isHomeDelivery) : undefined,
            (user.roles || []).map(role => new UserRole(role)),
            user.password,
            user.refreshToken
        ) : null;
    }
}
