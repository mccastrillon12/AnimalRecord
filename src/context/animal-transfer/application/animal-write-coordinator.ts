import { Inject, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AnimalAccessPolicy } from '../../animal/application/animal-access-policy';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS } from '../../shared/domain/animal-upload-policy';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

@Injectable()
export class AnimalWriteCoordinator {
  private readonly logger = new Logger(AnimalWriteCoordinator.name);

  constructor(
    private readonly access: AnimalAccessPolicy,
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
  ) {}

  async run<T>(
    animalIds: string[],
    actorId: string,
    operation: () => Promise<T>,
    options: { issuesUploadUrl?: boolean } = {},
  ): Promise<T> {
    if (!animalIds.length)
      throw new InvalidArgumentError(
        'At least one animal is required for a coordinated write',
      );
    const claimed: string[] = [];
    const token = uuidv4();
    try {
      for (const animalId of [...new Set(animalIds)].sort()) {
        await this.access.findWritableAnimal(animalId, actorId);
        const control = await this.ownership.findControl(animalId);
        if (
          !control ||
          control.ownerId !== actorId ||
          !(await this.ownership.beginWrite({
            animalId,
            ownerId: actorId,
            expectedOwnershipVersion: control.ownershipVersion,
            token,
            startedAt: new Date().toISOString(),
          }))
        )
          throw new ConflictError(
            'The animal is temporarily locked while its transfer is processed',
          );
        claimed.push(animalId);
      }
      const result = await operation();
      if (options.issuesUploadUrl) {
        // Recorded before returning the URL and while our persistent write claim is held.
        const until = new Date(
          Date.now() + ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS * 1000,
        ).toISOString();
        for (const animalId of claimed) {
          if (
            !(await this.ownership.recordUploadWindow(animalId, token, until))
          )
            throw new ConflictError(
              'The animal upload window could not be recorded',
            );
        }
      }
      return result;
    } finally {
      for (const animalId of claimed) {
        try {
          await this.ownership.endWrite(animalId, token);
        } catch {
          // Never expire a possibly running write. Recovery must prove it has finished.
          // Preserve an already committed successful response; leave transfer blocked.
          this.logger.warn(
            `Write claim recovery required for animal ${animalId}, token ${token}`,
          );
        }
      }
    }
  }
}
