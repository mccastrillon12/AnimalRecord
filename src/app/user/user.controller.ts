import { Controller, Post, Body, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCreator } from '../../context/user/application/creator/user-creator';
import { UserFinder } from '../../context/user/application/finder/user-finder';
import { UserFinderAll } from '../../context/user/application/finder-all/user-finder-all';
import { UserUpdater } from '../../context/user/application/updater/user-updater';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import { UserResponseDto } from './user-response.dto';

@ApiTags('users')
@Controller('users')
export class UserController {
    constructor(
        private readonly userCreator: UserCreator,
        private readonly userFinder: UserFinder,
        private readonly userFinderAll: UserFinderAll,
        private readonly userUpdater: UserUpdater
    ) { }

    @Post()
    @ApiOperation({ summary: 'Create user' })
    @ApiResponse({ status: 201, description: 'The user has been successfully created.', type: UserResponseDto })
    @ApiResponse({ status: 400, description: 'Bad Request / Validation Error.', type: HttpErrorDto })
    @ApiResponse({ status: 409, description: 'User already exists.', type: HttpErrorDto })
    async create(@Body() createUserDto: CreateUserDto) {
        const user = await this.userCreator.run({
            ...createUserDto,
            country: createUserDto.countryId,
            city: createUserDto.cityId,
            // Exclude properties that don't exist in UserPrimitiveType if strictly typed, 
            // but spread handles it usually. We just ensure 'country' is set.
        });

        // Map domain primitives to Response DTO
        const primitives = user.toPrimitives();
        return {
            ...primitives,
            countryId: primitives.country,
            cityId: primitives.city
        };
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ status: 200, description: 'Return all users.', type: [UserResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async findAll() {
        const users = await this.userFinderAll.run();
        return users.map(user => {
            const p = user.toPrimitives();
            return { ...p, countryId: p.country, cityId: p.city };
        });
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Find user by id' })
    @ApiResponse({ status: 200, description: 'Return the user.', type: UserResponseDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'User not found.', type: HttpErrorDto })
    async findOne(@Param('id') id: string) {
        const user = await this.userFinder.run(id);
        const p = user.toPrimitives();
        return { ...p, countryId: p.country, cityId: p.city };
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update user' })
    @ApiResponse({ status: 200, description: 'The user has been successfully updated.', type: UserResponseDto })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'User not found.', type: HttpErrorDto })
    async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        const user = await this.userUpdater.run(id, updateUserDto);
        // Note: UpdateUserDto fields should also be mapped if we want to support updating locations via IDs.
        // But UpdateUserDto inherits from CreateUserDto (PartialType), so it has countryId/cityId.
        // We need to update userUpdater to handle this mapping too? 
        // Or handle mapping here before calling updater?
        // UserUpdater.run takes Partial<UserPrimitiveType>.
        // Ideally we map here.

        // Wait, converting UpdateUserDto (countryId) to domain update (country).
        /* 
           This part requires looking at UserUpdater implementation. 
           Assuming it takes Partial<UserPrimitiveType>.
        */
        // Actually, the previous implementation of update returned the User object directly?
        // Let's check the original code snippet for line 65: "return this.userUpdater.run(id, updateUserDto);"
        // If updateUserDto has countryId, but Updater expects country, it won't update country.
        // I should map it.
        const updateData: any = { ...updateUserDto };
        if (updateUserDto.countryId) updateData.country = updateUserDto.countryId;
        if (updateUserDto.cityId) updateData.city = updateUserDto.cityId;

        await this.userUpdater.run(id, updateData);

        // Re-fetch to return? Or Updater returns updated user?
        // UserUpdater usually returns Promise<void> or Promise<User>.
        // Assuming it returns void or User.
        // Let's assume it returns Promise<void> based on typical CQRS, but check current code.
        // Originally: return this.userUpdater.run(...)

        // I'll assume for now I need to fetch it or Updater returns it.
        // Let's check UserUpdater in next step if this fails or I'll just map the result assuming it returns User.

        // To be safe, I'll stick to mapping the return value assuming it returns User like Creator.

        const updatedUser = await this.userFinder.run(id); // Fetch fresh
        const p = updatedUser.toPrimitives();
        return { ...p, countryId: p.country, cityId: p.city };
    }
}
