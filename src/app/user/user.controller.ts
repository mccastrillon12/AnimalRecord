import { Controller, Post, Body, Get, Param, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateUserUseCase } from '../../context/user/application/create/create-user.usecase';
import { FindUserUseCase } from '../../context/user/application/find/find-user.usecase';
import { FindAllUsersUseCase } from '../../context/user/application/findall/find-all-users.usecase';
import { UpdateUserUseCase } from '../../context/user/application/update/update-user.usecase';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

@ApiTags('users')
@Controller('users')
export class UserController {
    constructor(
        private readonly createUserUseCase: CreateUserUseCase,
        private readonly findUserUseCase: FindUserUseCase,
        private readonly findAllUsersUseCase: FindAllUsersUseCase,
        private readonly updateUserUseCase: UpdateUserUseCase
    ) { }

    @Post()
    @ApiOperation({ summary: 'Create user' })
    @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
    async create(@Body() createUserDto: CreateUserDto) {
        return this.createUserUseCase.run(createUserDto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ status: 200, description: 'Return all users.' })
    async findAll() {
        return this.findAllUsersUseCase.run();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Find user by id' })
    @ApiResponse({ status: 200, description: 'Return the user.' })
    async findOne(@Param('id') id: string) {
        return this.findUserUseCase.run(id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update user' })
    @ApiResponse({ status: 200, description: 'The user has been successfully updated.' })
    async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.updateUserUseCase.run(id, updateUserDto);
    }
}
