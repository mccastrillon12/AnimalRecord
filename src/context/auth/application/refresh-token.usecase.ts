import { Injectable, Inject, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { UserId } from '../../user/domain/userId';

@Injectable()
export class RefreshTokenUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator,
        private readonly jwtService: JwtService,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        try {
            // Verify signature content
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.configService.getJwtRefreshSecret()
            });

            const userId = payload.sub;
            const user = await this.userRepository.findById(new UserId(userId));

            if (!user || !user.refreshToken) {
                throw new ForbiddenException('Access Denied');
            }

            const isRefreshTokenMatching = await this.passwordHasher.compare(refreshToken, user.refreshToken);
            if (!isRefreshTokenMatching) {
                throw new ForbiddenException('Access Denied');
            }

            // Generate new pair
            const newPayload = { sub: user.id.value, email: user.email.value };
            const newAccessToken = this.tokenGenerator.generate(newPayload);
            const newRefreshToken = this.tokenGenerator.generateRefresh(newPayload);

            // Update refresh token hash
            const newHashedRefreshToken = await this.passwordHasher.hash(newRefreshToken);
            user.refreshToken = newHashedRefreshToken;
            await this.userRepository.update(user);

            return { accessToken: newAccessToken, refreshToken: newRefreshToken };

        } catch (e) {
            throw new ForbiddenException('Access Denied');
        }
    }
}
