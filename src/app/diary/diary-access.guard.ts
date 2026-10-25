import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AnimalAccessPolicy } from '../../context/animal/application/animal-access-policy';
import { DiaryEntryFinder } from '../../context/diary/application/diary-entry-finder';
import { ResourceNotFoundError } from '../../context/shared/domain/errors/ResourceNotFoundError';
import { AuthenticatedRequest } from '../shared/authenticated-request';

type DiaryRequest = AuthenticatedRequest & {
  params: { animalId: string; entryId?: string };
};

@Injectable()
export class DiaryAccessGuard implements CanActivate {
  constructor(
    private readonly animalAccess: AnimalAccessPolicy,
    private readonly entryFinder: DiaryEntryFinder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DiaryRequest>();
    const { animalId, entryId } = request.params;
    await this.animalAccess.findOwnedAnimal(animalId, request.user.id);
    if (entryId) {
      const entry = await this.entryFinder.findById(entryId);
      if (entry.animalId.value !== animalId) {
        throw new ResourceNotFoundError(
          'Diary entry not found for this animal',
        );
      }
    }
    return true;
  }
}
