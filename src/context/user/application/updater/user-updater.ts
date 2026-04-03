import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User, UserPrimitiveType } from '../../domain/user';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class UserUpdater {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(id: string, data: Partial<UserPrimitiveType>): Promise<boolean> {
        const existingUser = await this.userRepository.findById(new Uuid(id));
        if (!existingUser) {
            throw new ResourceNotFoundError(`User with id ${id} not found`);
        }

        const currentPrimitives = existingUser.toPrimitives();
        
        // Prevent empty strings from overriding mandatory fields during partial updates
        const mandatoryFields: (keyof UserPrimitiveType)[] = ['name', 'identificationType', 'identificationNumber', 'authMethod'];
        mandatoryFields.forEach(field => {
            if (data[field] === '') {
                delete data[field];
            }
        });

        const updatedPrimitives = { ...currentPrimitives, ...data, id: id };
        const updatedUser = User.fromPrimitives(updatedPrimitives);

        return await this.userRepository.update(updatedUser);
    }
}
