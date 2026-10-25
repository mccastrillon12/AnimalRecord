import { Inject, Injectable } from '@nestjs/common';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { AnimalAccessPolicy } from '../../animal/application/animal-access-policy';

@Injectable()
export class MedicalDocumentAnimalAccess extends AnimalAccessPolicy {
  constructor(
    @Inject('AnimalRepository')
    animalRepository: AnimalRepository,
  ) {
    super(animalRepository);
  }
}
