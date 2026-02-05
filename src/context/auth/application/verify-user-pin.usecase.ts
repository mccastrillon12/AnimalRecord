import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';
import { Uuid } from '../../shared/domain/value-object/Uuid';

@Injectable()
export class VerifyUserPinUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(userId: string, pin: string): Promise<boolean> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (!user.pin) {
            throw new BadRequestException('User does not have a PIN set.');
        }

        const isPinValid = await this.passwordHasher.compare(pin, user.pin);
        if (!isPinValid) {
            throw new InvalidCredentialsError('Invalid PIN');
        }

        return true;
    }
}
