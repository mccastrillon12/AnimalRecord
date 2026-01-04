import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateUserUseCase } from '../../context/user/application/create/create-user.usecase';
import { FindUserUseCase } from '../../context/user/application/find/find-user.usecase';
import { CreateUserDto } from './create-user.dto';

@ApiTags('users')
@Controller('users')
export class UserController {
    constructor(
        private readonly createUserUseCase: CreateUserUseCase,
        private readonly findUserUseCase: FindUserUseCase
    ) { }

    @Post()
    @ApiOperation({ summary: 'Create user' })
    @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
    async create(@Body() createUserDto: CreateUserDto) {
        return this.createUserUseCase.run(createUserDto);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Find user by id' })
    @ApiResponse({ status: 200, description: 'Return the user.' })
    async findOne(@Param('id') id: string) {
        return this.findUserUseCase.run(id);
    }
}
