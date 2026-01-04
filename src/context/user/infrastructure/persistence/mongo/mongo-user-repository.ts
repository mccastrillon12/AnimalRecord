import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRepository } from '../../../domain/userRepository';
import { User } from '../../../domain/user';
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
            new UserCity(user.city),
            new UserEmail(user.email),
            new UserCellPhone(user.cellPhone),
            new UserProfessionalCard(user.professionalCard),
            new UserAnimalTypes(user.animalTypes),
            new UserServices(user.services),
            new UserIsHomeDelivery(user.isHomeDelivery)
        );
    }
}
