import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal, NameHistoryEntry } from '../../domain/animal';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const NAME_CHANGE_COOLDOWN_DAYS = 30;

@Injectable()
export class AnimalUpdater {
  constructor(
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
  ) {}

  async run(
    id: string,
    data: Partial<AnimalPrimitiveUpdate>,
    requestUserId: string,
  ): Promise<boolean> {
    const animal = await this.animalRepository.findById(new Uuid(id));
    if (!animal) {
      throw new ResourceNotFoundError(`Animal with id ${id} not found`);
    }

    if (!requestUserId || animal.ownerId.value !== requestUserId) {
      throw new ForbiddenException(
        'Solo el dueño del animal puede modificarlo.',
      );
    }
    if (data.ownerId !== undefined && data.ownerId !== animal.ownerId.value) {
      throw new BadRequestException(
        'La propiedad solo puede cambiarse mediante una transferencia.',
      );
    }

    const currentPrimitives = animal.toPrimitives();
    const now = new Date().toISOString();

    // Detect if the name is being changed
    const nameIsChanging =
      data.name !== undefined && data.name !== currentPrimitives.name;

    let nameHistory: NameHistoryEntry[] = currentPrimitives.nameHistory || [];
    let nameUpdatedAt = currentPrimitives.nameUpdatedAt;

    if (nameIsChanging && data.name !== undefined) {
      // Validate 30-day cooldown since last name change
      if (nameHistory.length > 1) {
        const lastEntry = nameHistory[nameHistory.length - 1];
        const lastChangeDate = new Date(lastEntry.date);
        const daysSinceLastChange =
          (new Date(now).getTime() - lastChangeDate.getTime()) /
          (1000 * 60 * 60 * 24);

        if (daysSinceLastChange < NAME_CHANGE_COOLDOWN_DAYS) {
          const daysRemaining = Math.ceil(
            NAME_CHANGE_COOLDOWN_DAYS - daysSinceLastChange,
          );
          throw new BadRequestException(
            `El nombre del animal solo puede cambiarse cada ${NAME_CHANGE_COOLDOWN_DAYS} días. ` +
              `Faltan ${daysRemaining} día(s) para poder cambiarlo nuevamente.`,
          );
        }
      }

      // Add new name to history
      nameHistory = [...nameHistory, { name: data.name, date: now }];
      nameUpdatedAt = now;
    }

    const updatedPrimitives = {
      ...currentPrimitives,
      ...data,
      id: id,
      ownerId: currentPrimitives.ownerId,
      code: currentPrimitives.code,
      createdAt: currentPrimitives.createdAt,
      updatedAt: now,
      nameUpdatedAt: nameUpdatedAt,
      nameHistory: nameHistory,
    };

    const updatedAnimal = Animal.fromPrimitives(updatedPrimitives);
    return await this.animalRepository.update(updatedAnimal);
  }
}

type AnimalPrimitiveUpdate = Omit<
  ReturnType<Animal['toPrimitives']>,
  'id' | 'code' | 'createdAt' | 'updatedAt' | 'nameHistory' | 'nameUpdatedAt'
>;
