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
import { AnimalCreator } from '../../context/animal/application/creator/animal-creator';
import { AnimalFinderByOwner } from '../../context/animal/application/finder-by-owner/animal-finder-by-owner';
import { AnimalUpdater } from '../../context/animal/application/updater/animal-updater';
import { AnimalFinderWithFilters } from '../../context/animal/application/finder-with-filters/animal-finder-with-filters';
import { CreateAnimalDto } from './create-animal.dto';
import { UpdateAnimalDto } from './update-animal.dto';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import { AnimalResponseDto } from './animal-response.dto';
import { GenerateAnimalProfilePictureUploadUrlUseCase } from '../../context/animal/application/profile-picture/generate-animal-profile-picture-upload-url.usecase';
import { UpdateAnimalProfilePictureUseCase } from '../../context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { AnimalAccessPolicy } from '../../context/animal/application/animal-access-policy';
import { AnimalFilters } from '../../context/animal/domain/animalFilters';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { AnimalWriteCoordinator } from '../../context/animal-transfer/application/animal-write-coordinator';

@ApiTags('animals')
@Controller('animals')
@ApiResponse({
  status: 403,
  description: 'The animal belongs to another user.',
  type: HttpErrorDto,
})
export class AnimalController {
  constructor(
    private readonly animalCreator: AnimalCreator,
    private readonly animalFinderByOwner: AnimalFinderByOwner,
    private readonly animalUpdater: AnimalUpdater,
    private readonly animalFinderWithFilters: AnimalFinderWithFilters,
    private readonly generateAnimalProfilePictureUploadUrlUseCase: GenerateAnimalProfilePictureUploadUrlUseCase,
    private readonly updateAnimalProfilePictureUseCase: UpdateAnimalProfilePictureUseCase,
    private readonly animalAccess: AnimalAccessPolicy,
    private readonly writes: AnimalWriteCoordinator,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create animal' })
  @ApiResponse({
    status: 201,
    description: 'The animal has been successfully created.',
    type: AnimalResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async create(
    @Body() createAnimalDto: CreateAnimalDto,
    @Request() req: AuthenticatedRequest,
  ) {
    this.animalAccess.assertOwnerId(createAnimalDto.ownerId, req.user.id);
    const animal = await this.animalCreator.run(createAnimalDto);
    return animal.toPrimitives();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get animals owned by the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Return the current user animals.',
    type: [AnimalResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async findAll(@Request() req: AuthenticatedRequest) {
    const animals = await this.animalFinderByOwner.run(req.user.id);
    return animals.map((animal) => animal.toPrimitives());
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Search animals with combined filters (species, sex, age ranges, date range, owner, active)',
  })
  @ApiQuery({
    name: 'species',
    required: false,
    example: 'Canino,Felino',
    description: 'Filter by species (comma-separated for multiple)',
  })
  @ApiQuery({
    name: 'sex',
    required: false,
    example: 'Hembra,Macho',
    description: 'Filter by sex (comma-separated for multiple)',
  })
  @ApiQuery({
    name: 'ageRanges',
    required: false,
    example: '0-6,12-36',
    description:
      'Age ranges in months (min-max pairs, comma-separated). E.g. 0-6,12-36 means 0-6 months OR 12-36 months',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    example: '2026-01-01T00:00:00.000Z',
    description: 'Filter by creation date from (ISO)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    example: '2026-12-31T23:59:59.999Z',
    description: 'Filter by creation date to (ISO)',
  })
  @ApiQuery({
    name: 'ownerId',
    required: false,
    description: 'Filter by owner UUID',
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description: 'Filter by active status (true/false)',
  })
  @ApiResponse({
    status: 200,
    description: 'Return filtered animals.',
    type: [AnimalResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async search(
    @Request() req: AuthenticatedRequest,
    @Query('species') species?: string,
    @Query('sex') sex?: string,
    @Query('ageRanges') ageRanges?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('ownerId') ownerId?: string,
    @Query('isActive') isActive?: string,
  ) {
    if (ownerId) this.animalAccess.assertOwnerId(ownerId, req.user.id);
    const filters: AnimalFilters = { dateFrom, dateTo, ownerId: req.user.id };

    // Parse comma-separated species into array
    if (species) {
      filters.species = species.split(',').map((s) => s.trim());
    }

    // Parse comma-separated sex into array
    if (sex) {
      filters.sex = sex.split(',').map((s) => s.trim());
    }

    // Parse ageRanges: "0-6,12-36" => [{min:0,max:6},{min:12,max:36}]
    if (ageRanges) {
      filters.ageRanges = ageRanges.split(',').map((pair) => {
        const [min, max] = pair.trim().split('-').map(Number);
        return { min, max };
      });
    }

    if (isActive !== undefined) filters.isActive = isActive === 'true';

    const animals = await this.animalFinderWithFilters.run(filters);
    return animals.map((animal) => animal.toPrimitives());
  }

  @Get('owner/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Find animals by owner id' })
  @ApiResponse({
    status: 200,
    description: 'Return animals belonging to owner.',
    type: [AnimalResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Owner or animals not found.',
    type: HttpErrorDto,
  })
  async findByOwner(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.animalAccess.assertOwnerId(id, req.user.id);
    const animals = await this.animalFinderByOwner.run(id);
    return animals.map((animal) => animal.toPrimitives());
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Find animal by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the animal.',
    type: AnimalResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Animal not found.',
    type: HttpErrorDto,
  })
  async findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const animal = await this.animalAccess.findOwnedAnimal(id, req.user.id);
    return animal.toPrimitives();
  }

  @Put(':id')
  @ApiResponse({
    status: 409,
    description:
      'Animal writes are temporarily blocked while its transfer is processed.',
    type: HttpErrorDto,
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update animal' })
  @ApiResponse({
    status: 200,
    description: 'The animal has been successfully updated.',
    type: AnimalResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Animal not found.',
    type: HttpErrorDto,
  })
  async update(
    @Param('id') id: string,
    @Body() updateAnimalDto: UpdateAnimalDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run([id], req.user.id, () =>
      this.animalUpdater.run(id, updateAnimalDto, req.user.id),
    );
  }

  @Get(':id/profile-picture/upload-url')
  @ApiResponse({
    status: 409,
    description:
      'Animal writes are temporarily blocked while its transfer is processed.',
    type: HttpErrorDto,
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Get a pre-signed URL to upload animal profile picture directly to S3',
    description:
      'Upload to the opaque uploadUrl, then confirm the returned finalUrl unchanged. New uploads use isolated staging; finalUrl is available only after backend confirmation. No additional client headers are required.',
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
  @ApiResponse({
    status: 404,
    description: 'Animal not found.',
    type: HttpErrorDto,
  })
  async getProfilePictureUploadUrl(
    @Param('id') animalId: string,
    @Query('mimeType') mimeType: string,
    @Query('fileSize') fileSize: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      () =>
        this.generateAnimalProfilePictureUploadUrlUseCase.run(
          animalId,
          mimeType,
          Number(fileSize),
        ),
      { issuesUploadUrl: true },
    );
  }

  @Patch(':id/profile-picture')
  @ApiResponse({
    status: 400,
    description: 'Invalid URL or metadata.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'S3 copy or verification failed; retry the same confirmation without uploading again.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Transfer reservation, pending upload, changed source, or conflicting destination. A conflict is not necessarily transfer processing.',
    type: HttpErrorDto,
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirm animal profile picture upload and update URL',
    description:
      'For newly issued URLs, verifies MIME/size and creates a write-once final copy before saving its reference. Repeating the same confirmation reconciles a lost copy response. Preserve the returned finalUrl; preview the local file until confirmation succeeds.',
  })
  @ApiBody({
    schema: { type: 'object', properties: { finalUrl: { type: 'string' } } },
  })
  @ApiResponse({
    status: 200,
    description: 'Profile picture updated successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal not found.',
    type: HttpErrorDto,
  })
  async confirmProfilePictureUpload(
    @Param('id') animalId: string,
    @Body('finalUrl') finalUrl: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run([animalId], req.user.id, async () => {
      await this.updateAnimalProfilePictureUseCase.run(animalId, finalUrl);
      return { success: true, profilePictureUrl: finalUrl };
    });
  }
}
