import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { IStorageService } from '../../domain/ports/IStorageService';
import { InvalidArgumentError } from '../../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';

@Injectable()
export class UpdateProfilePictureUseCase {
  constructor(
    @Inject('UserRepository') private readonly userRepository: UserRepository,
    @Inject('IStorageService') private readonly storageService: IStorageService,
  ) {}

  async run(userId: string, finalUrl: string): Promise<void> {
    const user = await this.userRepository.findById(new Uuid(userId));
    if (!user) {
      throw new ResourceNotFoundError('User not found');
    }

    const prefix = `users/${userId}/`;
    const key = this.storageService.getFileKey(finalUrl);
    if (
      !key?.startsWith(prefix) ||
      !/^profile_\d+\.(jpeg|png|webp)$/.test(key.slice(prefix.length))
    ) {
      throw new InvalidArgumentError(
        'The picture URL must belong to this user',
      );
    }
    const previousUrl = user.profilePictureUrl;
    user.profilePictureUrl = finalUrl;
    if (previousUrl === finalUrl) return;
    if (!(await this.userRepository.update(user)))
      throw new ConflictError('The user picture could not be updated');
    const previousKey = previousUrl
      ? this.storageService.getFileKey(previousUrl)
      : undefined;
    if (
      previousUrl &&
      previousKey?.startsWith(prefix) &&
      /^profile_\d+\.(jpeg|png|webp)$/.test(previousKey.slice(prefix.length))
    ) {
      await this.storageService.deleteFile(previousUrl);
    }
  }
}
