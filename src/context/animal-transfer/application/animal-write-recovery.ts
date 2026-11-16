import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import {
  ANIMAL_WRITE_RECOVERY_REASONS,
  AnimalWriteJournal,
  AnimalWriteRecoveryRequest,
} from '../domain/animal-write-journal';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

@Injectable()
export class AnimalWriteRecovery {
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
  ) {}

  /** Technical pre-callback intervention; never evidence of business rollback. */
  async recoverBeforeCallback(
    input: AnimalWriteRecoveryRequest,
  ): Promise<AnimalWriteJournal> {
    if (
      ![
        input.operationId,
        input.instanceId,
        input.requestId,
        input.operatorId,
      ].every(isUuid) ||
      !ANIMAL_WRITE_RECOVERY_REASONS.includes(input.reason) ||
      typeof input.evidenceRef !== 'string' ||
      input.evidenceRef.trim() !== input.evidenceRef ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.evidenceRef)
    )
      throw new InvalidArgumentError(
        'Invalid explicit animal write recovery request',
      );
    return this.ownership.recoverWriteBeforeCallback(input);
  }
}
