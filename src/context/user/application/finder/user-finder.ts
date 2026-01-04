import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User } from '../../domain/user';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { Nullable } from '../../../shared/domain/Nullable';

@Injectable()
export class UserFinder {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(id: string): Promise<Nullable<User>> {
        return await this.userRepository.findById(new Uuid(id));
    }
}
