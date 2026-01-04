import { Controller, Post, Body, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCreator } from '../../context/user/application/creator/user-creator';
import { UserFinder } from '../../context/user/application/finder/user-finder';
import { UserFinderAll } from '../../context/user/application/finder-all/user-finder-all';
import { UserUpdater } from '../../context/user/application/updater/user-updater';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';

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
    @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
    async create(@Body() createUserDto: CreateUserDto) {
        const user = await this.userCreator.run(createUserDto);
        return user.toPrimitives();
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ status: 200, description: 'Return all users.' })
    async findAll() {
        const users = await this.userFinderAll.run();
        return users.map(user => user.toPrimitives());
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Find user by id' })
    @ApiResponse({ status: 200, description: 'Return the user.' })
    async findOne(@Param('id') id: string) {
        const user = await this.userFinder.run(id);
        return user ? user.toPrimitives() : null;
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update user' })
    @ApiResponse({ status: 200, description: 'The user has been successfully updated.' })
    async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.userUpdater.run(id, updateUserDto);
    }
}
