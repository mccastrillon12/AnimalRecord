import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  AnimalOwnershipRepository,
  OwnershipPeriodStartProvenance,
} from '../domain/animal-ownership';

@Injectable()
export class AnimalOwnershipInitializer implements OnModuleInit {
  private readonly logger = new Logger(AnimalOwnershipInitializer.name);
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownershipRepository: AnimalOwnershipRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    let afterId: string | undefined;
    let checked = 0;
    let conflicts = 0;
    while (true) {
      const animals =
        await this.ownershipRepository.listAnimalsForInitialization(
          afterId,
          200,
        );
      if (animals.length === 0) {
        this.logger.log({
          event: 'animal-ownership-initialization-completed',
          checked,
          conflicts,
        });
        return;
      }
      for (const animal of animals) {
        checked += 1;
        try {
          await this.ownershipRepository.ensureCurrentOwnership({
            animalId: animal.id,
            ownerId: animal.ownerId,
            startedAt: animal.createdAt,
            startProvenance: animal.createdAt
              ? OwnershipPeriodStartProvenance.InferredFromAnimalCreation
              : OwnershipPeriodStartProvenance.Unknown,
          });
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
          conflicts += 1;
          this.logger.warn({
            event: 'animal-ownership-initialization-conflict',
            animalId: animal.id,
          });
        }
      }
      afterId = animals[animals.length - 1].id;
    }
  }
}
