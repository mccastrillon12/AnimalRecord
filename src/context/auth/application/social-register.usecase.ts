import { Injectable, Inject, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { User, UserPrimitiveType } from '../../user/domain/user';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { SocialRegisterDto } from '../../../app/auth/social-register.dto';

@Injectable()
export class SocialRegisterUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        private readonly jwtService: JwtService,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(dto: SocialRegisterDto): Promise<{ accessToken: string; refreshToken: string; user: UserPrimitiveType }> {
        // 1. Verify PreAuthToken
        let payload;
        try {
            payload = this.jwtService.verify(dto.preAuthToken, {
                secret: this.configService.getJwtSecret()
            });
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired Pre-Auth Token');
        }

        // 2. Check overlap again (paranoid check)
        const existingUserByEmail = await this.userRepository.findByEmail(payload.email);
        if (existingUserByEmail) {
            throw new ConflictError(`User with email ${payload.email} already exists`);
        }

        if (dto.cellPhone) {
            const existingUserByPhone = await this.userRepository.findByCellPhone(dto.cellPhone);
            if (existingUserByPhone) {
                throw new ConflictError(`User with cell phone ${dto.cellPhone} already exists`);
            }
        }

        if (dto.identificationNumber) {
            const existingUserById = await this.userRepository.findByIdentificationNumber(dto.identificationNumber);
            if (existingUserById) {
                throw new ConflictError(`User with identification number ${dto.identificationNumber} already exists`);
            }
        }

        // 3. Create User
        // Note: We use data from Token (trusted) + Data from DTO (user input)
        const user = User.fromPrimitives({
            id: Uuid.random().value,
            name: `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || 'User',
            email: payload.email,
            authMethod: payload.authMethod,
            isVerified: true, // Social users are verified
            roles: dto.roles || ['USER'],

            // From DTO
            identificationType: dto.identificationType,
            identificationNumber: dto.identificationNumber,
            country: dto.country,
            department: dto.department,
            city: dto.city,
            address: dto.address,
            cellPhone: dto.cellPhone,

            // Optional fields
            professionalCard: dto.professionalCard,
            animalTypes: dto.animalTypes,
            services: dto.services,
            isHomeDelivery: dto.isHomeDelivery,

            // Provider IDs
            googleId: payload.googleId,
            appleId: payload.appleId,
            microsoftId: payload.microsoftId,
            isBiometricEnabled: false
        });

        await this.userRepository.insert(user);

        // 4. Login (Generate Tokens)
        const tokenPayload = { sub: user.id.value, email: user.email?.value };
        const accessToken = this.tokenGenerator.generate(tokenPayload);
        const refreshToken = this.tokenGenerator.generateRefresh(tokenPayload);

        // Save Refresh Token
        const hashedRefreshToken = await this.passwordHasher.hash(refreshToken);
        user.refreshToken = hashedRefreshToken;
        await this.userRepository.update(user);

        return { accessToken, refreshToken, user: user.toPrimitives() };
    }
}
