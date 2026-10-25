import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  UseGuards,
  Patch,
  Query,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { UserCreator } from '../../context/user/application/creator/user-creator';
import { UserFinder } from '../../context/user/application/finder/user-finder';
import { UserFinderAll } from '../../context/user/application/finder-all/user-finder-all';
import { UserFinderByIdentification } from '../../context/user/application/finder-by-identification/user-finder-by-identification';
import { UserUpdater } from '../../context/user/application/updater/user-updater';
import { GenerateProfilePictureUploadUrlUseCase } from '../../context/user/application/profile-picture/generate-profile-picture-upload-url.usecase';
import { UpdateProfilePictureUseCase } from '../../context/user/application/profile-picture/update-profile-picture.usecase';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { CheckAvailabilityDto } from './check-availability.dto';
import { CheckUserAvailabilityUseCase } from '../../context/user/application/availability/check-user-availability.usecase';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import { UserResponseDto } from './user-response.dto';
import { toUserResponse } from './user-response.mapper';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { ForbiddenError } from '../../context/shared/domain/errors/ForbiddenError';
import { UserPrimitiveType } from '../../context/user/domain/user';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(
    private readonly userCreator: UserCreator,
    private readonly userFinder: UserFinder,
    private readonly userFinderByIdentification: UserFinderByIdentification,
    private readonly userFinderAll: UserFinderAll,
    private readonly userUpdater: UserUpdater,
    private readonly checkUserAvailabilityUseCase: CheckUserAvailabilityUseCase,
    private readonly generateProfilePictureUploadUrlUseCase: GenerateProfilePictureUploadUrlUseCase,
    private readonly updateProfilePictureUseCase: UpdateProfilePictureUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create user' })
  @ApiResponse({
    status: 201,
    description: 'The user has been successfully created.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request / Validation Error.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists.',
    type: HttpErrorDto,
  })
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.userCreator.run({
      ...createUserDto,
      country: createUserDto.countryId,
      department: createUserDto.departmentId,
      city: createUserDto.cityId,
    });

    return toUserResponse(user);
  }

  @Post('check-availability')
  @ApiOperation({
    summary: 'Check if email, phone or identification number are available',
  })
  @ApiResponse({
    status: 200,
    description: 'Return availability status for each field.',
  })
  async checkAvailability(@Body() dto: CheckAvailabilityDto) {
    return this.checkUserAvailabilityUseCase.run(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({
    status: 200,
    description: 'Return all users.',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async findAll() {
    const users = await this.userFinderAll.run();
    return users.map(toUserResponse);
  }

  @Get('identification/:number')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Find user by identification number' })
  @ApiResponse({
    status: 200,
    description: 'Return the user.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
    type: HttpErrorDto,
  })
  async findByIdentification(@Param('number') number: string) {
    const user = await this.userFinderByIdentification.run(number);
    return toUserResponse(user);
  }

  @Get('me/profile-picture/upload-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a pre-signed URL to upload profile picture directly to S3',
  })
  @ApiQuery({ name: 'mimeType', required: true, example: 'image/jpeg' })
  @ApiQuery({ name: 'fileSize', required: true, example: 150000 })
  @ApiResponse({
    status: 200,
    description: 'Return the upload URL and final URL.',
  })
  @ApiResponse({
    status: 400,
    description: 'File type or size invalid.',
    type: HttpErrorDto,
  })
  async getProfilePictureUploadUrl(
    @Request() req: AuthenticatedRequest,
    @Query('mimeType') mimeType: string,
    @Query('fileSize') fileSize: string,
  ) {
    return this.generateProfilePictureUploadUrlUseCase.run(
      req.user.id,
      mimeType,
      Number(fileSize),
    );
  }

  @Patch('me/profile-picture')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirm profile picture upload and update URL in profile',
  })
  @ApiBody({
    schema: { type: 'object', properties: { finalUrl: { type: 'string' } } },
  })
  @ApiResponse({
    status: 200,
    description: 'Profile picture updated successfully.',
  })
  async confirmProfilePictureUpload(
    @Request() req: AuthenticatedRequest,
    @Body('finalUrl') finalUrl: string,
  ) {
    await this.updateProfilePictureUseCase.run(req.user.id, finalUrl);
    return { success: true, profilePictureUrl: finalUrl };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Find user by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the user.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
    type: HttpErrorDto,
  })
  async findOne(@Param('id') id: string) {
    const user = await this.userFinder.run(id);
    return toUserResponse(user);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({
    status: 200,
    description: 'The user has been successfully updated.',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
    type: HttpErrorDto,
  })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: AuthenticatedRequest,
  ) {
    if (req.user.id !== id)
      throw new ForbiddenError('Users can only update their own profile');
    const updateData: Partial<UserPrimitiveType> = { ...updateUserDto };
    if (updateUserDto.countryId !== undefined)
      updateData.country = updateUserDto.countryId;
    if (updateUserDto.departmentId !== undefined)
      updateData.department = updateUserDto.departmentId;
    if (updateUserDto.cityId !== undefined)
      updateData.city = updateUserDto.cityId;

    await this.userUpdater.run(id, updateData);

    const updatedUser = await this.userFinder.run(id);
    return toUserResponse(updatedUser);
  }
}
