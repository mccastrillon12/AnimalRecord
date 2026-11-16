import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  AnimalOwnershipRepository,
  OwnershipPeriodStartProvenance,
} from '../domain/animal-ownership';

@Injectable()
export class AnimalOwnershipInitializer implements OnModuleInit {
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownershipRepository: AnimalOwnershipRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    let afterId: string | undefined;
    while (true) {
      const animals =
        await this.ownershipRepository.listAnimalsForInitialization(
          afterId,
          200,
        );
      if (animals.length === 0) return;
      for (const animal of animals) {
        await this.ownershipRepository.ensureCurrentOwnership({
          animalId: animal.id,
          ownerId: animal.ownerId,
          startedAt: animal.createdAt,
          startProvenance: animal.createdAt
            ? OwnershipPeriodStartProvenance.InferredFromAnimalCreation
            : OwnershipPeriodStartProvenance.Unknown,
        });
      }
      afterId = animals[animals.length - 1].id;
    }
  }
}
