import { Inject, Injectable } from '@nestjs/common';
import { Animal } from '../domain/animal';
import { AnimalRepository } from '../domain/animalRepository';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  AnimalOwnershipRepository,
  OwnershipPeriodStartProvenance,
} from '../../animal-transfer/domain/animal-ownership';

/** Current ownership policy. Historical views and explicit grants are separate. */
@Injectable()
export class AnimalAccessPolicy {
  constructor(
    @Inject('AnimalRepository')
    private readonly repository: AnimalRepository,
    @Inject('AnimalOwnershipRepository')
    private readonly ownershipRepository: AnimalOwnershipRepository,
  ) {}

  assertOwnerId(ownerId: string, actorId: string): void {
    if (!actorId || ownerId !== actorId) {
      throw new ForbiddenError('The animal does not belong to the user');
    }
  }

  async findOwnedAnimal(animalId: string, actorId: string): Promise<Animal> {
    const animal = await this.repository.findById(new Uuid(animalId));
    if (!animal) {
      throw new ResourceNotFoundError(`Animal with id ${animalId} not found`);
    }
    this.assertOwnerId(animal.ownerId.value, actorId);
    return animal;
  }

  async findOwnedAnimals(
    animalIds: string[],
    actorId: string,
  ): Promise<Map<string, Animal>> {
    const animals = await Promise.all(
      [...new Set(animalIds)].map((id) => this.findOwnedAnimal(id, actorId)),
    );
    return new Map(animals.map((animal) => [animal.id.value, animal]));
  }

  async findWritableAnimal(animalId: string, actorId: string): Promise<Animal> {
    const animal = await this.findOwnedAnimal(animalId, actorId);
    await this.ensureOwnershipState(animal);
    const control = await this.ownershipRepository.findControl(animalId);
    if (!control || control.ownerId !== actorId) {
      throw new ConflictError('The animal ownership control is inconsistent');
    }
    if (control.transferLock) {
      throw new ConflictError(
        'The animal is temporarily locked while its transfer is processed',
      );
    }
    return animal;
  }

  async findWritableAnimals(
    animalIds: string[],
    actorId: string,
  ): Promise<Map<string, Animal>> {
    const animals = await Promise.all(
      [...new Set(animalIds)].map((id) => this.findWritableAnimal(id, actorId)),
    );
    return new Map(animals.map((animal) => [animal.id.value, animal]));
  }

  async findTransferableAnimal(
    animalId: string,
    actorId: string,
  ): Promise<Animal> {
    const animal = await this.findOwnedAnimal(animalId, actorId);
    if (!animal.isActive) {
      throw new ConflictError('Only active animals can be transferred');
    }
    return animal;
  }

  private async ensureOwnershipState(animal: Animal): Promise<void> {
    await this.ownershipRepository.ensureCurrentOwnership({
      animalId: animal.id.value,
      ownerId: animal.ownerId.value,
      startedAt: animal.createdAt,
      startProvenance: animal.createdAt
        ? OwnershipPeriodStartProvenance.InferredFromAnimalCreation
        : OwnershipPeriodStartProvenance.Unknown,
    });
  }
}
