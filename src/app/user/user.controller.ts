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
        const user = await this.userCreator.run(createUserDto);
        return user.toPrimitives();
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ status: 200, description: 'Return all users.', type: [UserResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async findAll() {
        const users = await this.userFinderAll.run();
        return users.map(user => user.toPrimitives());
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
        return user.toPrimitives();
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
        return this.userUpdater.run(id, updateUserDto);
    }
}
