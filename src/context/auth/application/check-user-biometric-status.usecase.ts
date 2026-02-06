import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { Uuid } from '../../shared/domain/value-object/Uuid';

@Injectable()
export class CheckUserBiometricStatusUseCase {
    constructor(@Inject('UserRepository') private readonly userRepository: UserRepository) { }

    async run(userId: string): Promise<{ isBiometricEnabled: boolean }> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new NotFoundException('User not found');
        }

        return { isBiometricEnabled: user.isBiometricEnabled };
    }
}
