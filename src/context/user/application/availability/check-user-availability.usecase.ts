import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';

export interface AvailabilityCheckInput {
    email?: string;
    cellPhone?: string;
    identificationNumber?: string;
}

export interface AvailabilityStatus {
    email?: boolean;
    cellPhone?: boolean;
    identificationNumber?: boolean;
}

@Injectable()
export class CheckUserAvailabilityUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(input: AvailabilityCheckInput): Promise<AvailabilityStatus> {
        const result: AvailabilityStatus = {};

        if (input.email) {
            const user = await this.userRepository.findByEmail(input.email);
            result.email = !user;
        }

        if (input.cellPhone) {
            const user = await this.userRepository.findByCellPhone(input.cellPhone);
            result.cellPhone = !user;
        }

        if (input.identificationNumber) {
            const user = await this.userRepository.findByIdentificationNumber(input.identificationNumber);
            result.identificationNumber = !user;
        }

        return result;
    }
}
