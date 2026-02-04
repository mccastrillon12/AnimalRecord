import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';
import { Uuid } from '../../shared/domain/value-object/Uuid';

@Injectable()
export class ChangePasswordUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(userId: string, oldPassword: string, newPassword: string): Promise<void> {
        // 1. Find User by ID
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new NotFoundException('User not found');
        }

        // 2. Check if user has a password (social login users might not)
        if (!user.password) {
            throw new BadRequestException('User does not have a password set. Log in via social provider.');
        }

        // 3. Verify Old Password
        const isPasswordValid = await this.passwordHasher.compare(oldPassword, user.password);
        if (!isPasswordValid) {
            throw new InvalidCredentialsError('Invalid old password');
        }

        // 4. Hash New Password
        const hashedPassword = await this.passwordHasher.hash(newPassword);
        user.password = hashedPassword;

        // 5. Save
        await this.userRepository.update(user);
    }
}
