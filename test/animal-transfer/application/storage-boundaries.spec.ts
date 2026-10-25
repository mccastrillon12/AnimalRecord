import { AwsS3StorageService } from '../../../src/context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { Animal } from '../../../src/context/animal/domain/animal';
import { DiaryAttachmentManager } from '../../../src/context/diary/application/diary-attachment-manager';
import { DiaryRepository } from '../../../src/context/diary/domain/diary-repository';
import { DiaryEntry } from '../../../src/context/diary/domain/diary-entry';
import { IStorageService } from '../../../src/context/user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';

describe('Animal file ownership boundaries', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const animalId = '123e4567-e89b-42d3-a456-426614174002';
  const attachmentId = '123e4567-e89b-42d3-a456-426614174003';
  const origin = 'https://animal-record-test.s3.us-east-1.amazonaws.com';
  const storage = new AwsS3StorageService({
    getAwsS3BucketName: () => 'animal-record-test',
    getAwsS3Region: () => 'us-east-1',
  } as unknown as EnvironmentConfigService);
  const key = `users/${ownerId}/animals/${animalId}`;
  const makeAnimal = () =>
    Animal.fromPrimitives({
      id: animalId,
      ownerId,
      name: 'Brownie',
      species: 'DOG',
      breed: 'Labrador',
      code: 'AR-C001',
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
      profilePictureUrl: `${origin}/${key}/profile_100.jpeg`,
    });

  it('accepts only final URLs in the configured bucket', () => {
    expect(storage.getFileKey(`${origin}/${key}/profile_100.jpeg`)).toBe(
      `${key}/profile_100.jpeg`,
    );
    for (const url of [
      `https://foreign-bucket.s3.us-east-1.amazonaws.com/${key}/profile_100.jpeg`,
      `${origin}/${key}/profile_100.jpeg?x=1`,
      `http://animal-record-test.s3.us-east-1.amazonaws.com/${key}/profile_100.jpeg`,
      `${origin}/${key}/%2e%2e%2fprivate`,
      'invalid',
    ])
      expect(storage.getFileKey(url)).toBeUndefined();
  });

  it('rejects foreign picture paths before persistence or deletion', async () => {
    const update = jest.fn();
    const deleteFile = jest.fn();
    const service = new UpdateAnimalProfilePictureUseCase(
      {
        findById: () => Promise.resolve(makeAnimal()),
        update,
      } as unknown as AnimalRepository,
      {
        generatePreSignedUploadUrl: jest.fn(),
        getFileKey: (url: string) => storage.getFileKey(url),
        deleteFile,
      } as IStorageService,
    );
    await expect(
      service.run(
        animalId,
        `${origin}/users/foreign/animals/${animalId}/profile_200.jpeg`,
      ),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(update).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('persists a valid new picture before deleting the old one', async () => {
    const operations: string[] = [];
    const service = new UpdateAnimalProfilePictureUseCase(
      {
        findById: () => Promise.resolve(makeAnimal()),
        update: () => {
          operations.push('persist');
          return Promise.resolve(true);
        },
      } as unknown as AnimalRepository,
      {
        generatePreSignedUploadUrl: jest.fn(),
        getFileKey: (url: string) => storage.getFileKey(url),
        deleteFile: () => {
          operations.push('delete');
          return Promise.resolve();
        },
      } as IStorageService,
    );
    await service.run(animalId, `${origin}/${key}/profile_200.jpeg`);
    expect(operations).toEqual(['persist', 'delete']);
  });

  it('retains the old object if saving the new picture fails', async () => {
    const deleteFile = jest.fn();
    const service = new UpdateAnimalProfilePictureUseCase(
      {
        findById: () => Promise.resolve(makeAnimal()),
        update: () => Promise.resolve(false),
      } as unknown as AnimalRepository,
      {
        generatePreSignedUploadUrl: jest.fn(),
        getFileKey: (url: string) => storage.getFileKey(url),
        deleteFile,
      } as IStorageService,
    );
    await expect(
      service.run(animalId, `${origin}/${key}/profile_200.jpeg`),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('accepts a matching diary upload once and rejects foreign URLs', async () => {
    const entry = DiaryEntry.create(animalId, 'Control');
    const update = jest.fn().mockResolvedValue(true);
    const manager = new DiaryAttachmentManager(
      {
        findById: () => Promise.resolve(entry),
        update,
      } as unknown as DiaryRepository,
      {
        findById: () => Promise.resolve(makeAnimal()),
      } as unknown as AnimalRepository,
      {
        generatePreSignedUploadUrl: jest.fn(),
        deleteFile: jest.fn(),
        getFileKey: (url: string) => storage.getFileKey(url),
      } as IStorageService,
    );
    const finalUrl = `${origin}/${key}/diary/${entry.id.value}/${attachmentId}.jpg`;
    const confirm = (url: string) =>
      manager.confirmAttachment(
        animalId,
        entry.id.value,
        attachmentId,
        url,
        'foto.jpg',
        'image/jpeg',
        100,
      );
    await expect(confirm(`${origin}/users/foreign/file.jpg`)).rejects.toThrow(
      'must belong',
    );
    expect(update).not.toHaveBeenCalled();
    await confirm(finalUrl);
    await confirm(finalUrl);
    expect(entry.attachments).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
