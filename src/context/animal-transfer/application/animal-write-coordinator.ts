import { Inject, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AnimalAccessPolicy } from '../../animal/application/animal-access-policy';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS } from '../../shared/domain/animal-upload-policy';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ANIMAL_WRITE_KINDS,
  AnimalWriteJournalRepository,
  AnimalWriteKind,
} from '../domain/animal-write-journal';
import { AnimalWriteInstance } from './animal-write-instance';

@Injectable()
export class AnimalWriteCoordinator {
  private readonly logger = new Logger(AnimalWriteCoordinator.name);

  constructor(
    private readonly access: AnimalAccessPolicy,
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
    @Inject('AnimalWriteJournal')
    private readonly journal: AnimalWriteJournalRepository,
    private readonly instance: AnimalWriteInstance,
  ) {}

  async run<T>(
    animalIds: string[],
    actorId: string,
    operation: () => Promise<T>,
    options: { issuesUploadUrl?: boolean; kind?: AnimalWriteKind } = {},
  ): Promise<T> {
    if (!animalIds.length)
      throw new InvalidArgumentError(
        'At least one animal is required for a coordinated write',
      );
    const claimed: string[] = [];
    const animals = [...new Set(animalIds)].sort();
    const kind = options.kind ?? 'UNSPECIFIED';
    if (!ANIMAL_WRITE_KINDS.includes(kind))
      throw new InvalidArgumentError('Invalid backend write operation kind');
    // Deny unauthorized/locked requests before journaling. Acquisition still
    // compares current owner/version/lock atomically after this preflight.
    for (const animalId of animals)
      await this.access.findWritableAnimal(animalId, actorId);
    const token = uuidv4();
    const handle = { id: token, instanceId: this.instance.id };
    const createdAt = new Date().toISOString();
    try {
      await this.journal.create({
        ...handle,
        actorId,
        kind,
        instanceStartedAt: this.instance.startedAt,
        createdAt,
        updatedAt: createdAt,
        issuesUploadUrl: !!options.issuesUploadUrl,
        lifecycle: 'OPEN',
        callback: 'NOT_STARTED',
        claims: animals.map((animalId) => ({
          animalId,
          state: 'NOT_ATTEMPTED',
          updatedAt: createdAt,
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Write journal creation recovery required for operation ${token}`,
      );
      throw error; // No claim or callback has been attempted.
    }
    const record = async (write: () => Promise<void>) => {
      try {
        await write();
      } catch {
        this.logger.warn(
          `Write journal recovery required for operation ${token}`,
        );
      }
    };
    let invoked = false;
    let outcome: 'RETURNED' | 'THREW' = 'THREW';
    try {
      for (const animalId of animals) {
        const control = await this.ownership.findControl(animalId);
        if (!control || control.ownerId !== actorId)
          throw new ConflictError(
            'The animal is temporarily locked while its transfer is processed',
          );
        await this.journal.claim(
          handle,
          animalId,
          'INTENT',
          new Date().toISOString(),
          control.ownershipVersion,
        );
        let acquired: boolean;
        try {
          acquired = await this.ownership.beginWrite({
            animalId,
            ownerId: actorId,
            expectedOwnershipVersion: control.ownershipVersion,
            token,
            startedAt: new Date().toISOString(),
            journal: { operationId: token, instanceId: this.instance.id },
          });
        } catch (error) {
          await record(() =>
            this.journal.claim(
              handle,
              animalId,
              'ACQUIRE_UNKNOWN',
              new Date().toISOString(),
            ),
          );
          throw error; // Never release a possibly acquired but unacknowledged claim.
        }
        if (!acquired) {
          await record(() =>
            this.journal.claim(
              handle,
              animalId,
              'NOT_ACQUIRED',
              new Date().toISOString(),
            ),
          );
          throw new ConflictError(
            'The animal is temporarily locked while its transfer is processed',
          );
        }
        claimed.push(animalId);
        await this.journal.claim(
          handle,
          animalId,
          'ACQUIRED',
          new Date().toISOString(),
        );
      }
      await this.journal.permitCallback(handle, new Date().toISOString());
      let result: T;
      try {
        invoked = true;
        result = await operation();
      } catch (error) {
        await record(() =>
          this.journal.settleCallback(
            handle,
            'THREW',
            new Date().toISOString(),
          ),
        );
        throw error;
      }
      await record(() =>
        this.journal.settleCallback(
          handle,
          'RETURNED',
          new Date().toISOString(),
        ),
      );
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
      outcome = 'RETURNED';
      return result;
    } finally {
      if (!invoked)
        await record(() =>
          this.journal.settleCallback(
            handle,
            'NOT_INVOKED',
            new Date().toISOString(),
          ),
        );
      for (const animalId of claimed) {
        let released = false;
        try {
          await this.ownership.endWrite(animalId, token);
          released = true;
        } catch {
          // Never expire a possibly running write. Recovery must prove it has finished.
          // Preserve an already committed successful response; leave transfer blocked.
          this.logger.warn(
            `Write claim recovery required for animal ${animalId}, token ${token}`,
          );
        }
        await record(() =>
          this.journal.claim(
            handle,
            animalId,
            released ? 'RELEASED' : 'RELEASE_UNKNOWN',
            new Date().toISOString(),
          ),
        );
      }
      await record(() =>
        this.journal.finish(handle, outcome, new Date().toISOString()),
      );
    }
  }
}
