import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { Uuid } from '../../shared/domain/value-object/Uuid';

@Injectable()
export class CreateUserPinUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(userId: string, pin: string): Promise<void> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new NotFoundException('User not found');
        }



        const hashedPin = await this.passwordHasher.hash(pin);
        user.pin = hashedPin;

        await this.userRepository.update(user);
    }
}
