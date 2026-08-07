import { Inject, Injectable } from '@nestjs/common';
import { Animal } from '../../animal/domain/animal';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class MedicalDocumentAnimalAccess {
  constructor(
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
  ) {}

  async findOwnedAnimals(
    animalIds: string[],
    ownerId: string,
  ): Promise<Map<string, Animal>> {
    const uniqueAnimalIds = [...new Set(animalIds)];
    const animals = await Promise.all(
      uniqueAnimalIds.map(async (animalId) => {
        const animal = await this.animalRepository.findById(new Uuid(animalId));
        if (!animal) {
          throw new ResourceNotFoundError(
            `Animal with id ${animalId} not found`,
          );
        }
        if (animal.ownerId.value !== ownerId) {
          throw new ForbiddenError(
            'The document can only be associated with animals owned by the user',
          );
        }
        return animal;
      }),
    );

    return new Map(animals.map((animal) => [animal.id.value, animal]));
  }
}
