import { Injectable, Inject, Logger } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal, AnimalPrimitiveType } from '../../domain/animal';
import { AnimalCodeGenerator } from '../generators/animal-code-generator';
import {
  AnimalOwnershipRepository,
  OwnershipPeriodStartProvenance,
} from '../../../animal-transfer/domain/animal-ownership';

@Injectable()
export class AnimalCreator {
  private readonly logger = new Logger(AnimalCreator.name);

  constructor(
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
    private readonly codeGenerator: AnimalCodeGenerator,
    @Inject('AnimalOwnershipRepository')
    private readonly ownershipRepository: AnimalOwnershipRepository,
  ) {}

  async run(data: Omit<AnimalPrimitiveType, 'code'>): Promise<Animal> {
    const code = await this.codeGenerator.generate(data.species);
    const now = new Date().toISOString();
    const animalData: AnimalPrimitiveType = {
      ...data,
      code: code,
      createdAt: now,
      updatedAt: now,
      nameUpdatedAt: undefined,
      nameHistory: [{ name: data.name, date: now }],
    };
    const animal = Animal.fromPrimitives(animalData);
    const createdAnimal = await this.animalRepository.insert(animal);
    try {
      await this.ownershipRepository.ensureCurrentOwnership({
        animalId: createdAnimal.id.value,
        ownerId: createdAnimal.ownerId.value,
        startedAt: now,
        startProvenance: OwnershipPeriodStartProvenance.Created,
      });
    } catch {
      // The animal is already committed. Bootstrap repairs the auxiliary state;
      // the write policy checks/repairs it before allowing further mutations.
      this.logger.warn(
        `Ownership initialization pending for animal ${createdAnimal.id.value}`,
      );
    }
    return createdAnimal;
  }
}
