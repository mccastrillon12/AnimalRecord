import { AwsS3StorageService } from '../../../src/context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { Animal } from '../../../src/context/animal/domain/animal';
import { DiaryAttachmentManager } from '../../../src/context/diary/application/diary-attachment-manager';
import { DiaryRepository } from '../../../src/context/diary/domain/diary-repository';
import {
  Attachment,
  DiaryEntry,
} from '../../../src/context/diary/domain/diary-entry';
import { IStorageService } from '../../../src/context/user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import { GenerateAnimalProfilePictureUploadUrlUseCase } from '../../../src/context/animal/application/profile-picture/generate-animal-profile-picture-upload-url.usecase';

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
  const legacyUploads = {
    confirm: () => Promise.resolve(),
  } as unknown as AnimalMediaUploads;
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
      legacyUploads,
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
      legacyUploads,
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
      legacyUploads,
    );
    await expect(
      service.run(animalId, `${origin}/${key}/profile_200.jpeg`),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('issues collision-resistant opaque profile keys without signing a direct final PUT', async () => {
    const issued = {
      uploadUrl: 'signed-staging',
      finalUrl: 'opaque-final',
    };
    const issue = jest.fn().mockResolvedValue(issued);
    const service = new GenerateAnimalProfilePictureUploadUrlUseCase(
      {
        findById: () => Promise.resolve(makeAnimal()),
      } as unknown as AnimalRepository,
      { issue } as unknown as AnimalMediaUploads,
    );
    await expect(service.run(animalId, 'image/jpeg', 100)).resolves.toEqual({
      uploadUrl: 'signed-staging',
      finalUrl: 'opaque-final',
    });
    expect(issue).toHaveBeenCalledWith(
      ownerId,
      animalId,
      expect.stringMatching(/\/profile_\d{22}\.jpeg$/),
      'image/jpeg',
      100,
    );
  });

  it('does not persist or delete the old profile if protected confirmation fails', async () => {
    const update = jest.fn();
    const deleteFile = jest.fn();
    const confirm = jest
      .fn()
      .mockRejectedValue(new ConflictError('Upload not ready'));
    const service = new UpdateAnimalProfilePictureUseCase(
      {
        findById: () => Promise.resolve(makeAnimal()),
        update,
      } as unknown as AnimalRepository,
      {
        getFileKey: (url: string) => storage.getFileKey(url),
        deleteFile,
      } as unknown as IStorageService,
      { confirm } as unknown as AnimalMediaUploads,
    );
    await expect(
      service.run(animalId, `${origin}/${key}/profile_200.jpeg`),
    ).rejects.toThrow('Upload not ready');
    expect(update).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('verifies the protected upload before saving a diary reference and reports a persistence conflict', async () => {
    const entry = DiaryEntry.create(animalId, 'Control');
    const update = jest.fn().mockResolvedValue(false);
    const confirm = jest.fn().mockResolvedValue(undefined);
    const manager = new DiaryAttachmentManager(
      {
        findById: () => Promise.resolve(entry),
        update,
      } as unknown as DiaryRepository,
      {
        findById: () => Promise.resolve(makeAnimal()),
      } as unknown as AnimalRepository,
      {
        getFileKey: (url: string) => storage.getFileKey(url),
      } as unknown as IStorageService,
      { confirm } as unknown as AnimalMediaUploads,
    );
    const url = `${origin}/${key}/diary/${entry.id.value}/${attachmentId}.jpg`;
    await expect(
      manager.confirmAttachment(
        animalId,
        entry.id.value,
        attachmentId,
        url,
        'photo.jpg',
        'image/jpeg',
        100,
      ),
    ).rejects.toThrow('could not be saved');
    expect(confirm).toHaveBeenCalledWith(
      ownerId,
      animalId,
      url,
      'image/jpeg',
      100,
    );
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
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
      legacyUploads,
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

  it('confirms an existing migrated canonical diary URL without changing identity, dates or persisting again', async () => {
    const entry = DiaryEntry.create(animalId, 'Control');
    const url = `${origin}/${key}/diary/${entry.id.value}/${attachmentId}/sealed_${animalId}.jpg`;
    entry.addAttachment(
      new Attachment(
        attachmentId,
        'foto.jpg',
        'image',
        'image/jpeg',
        url,
        100,
        '2020-01-01',
      ),
    );
    const before = entry.toPrimitives();
    const update = jest.fn();
    const confirm = jest.fn().mockResolvedValue(undefined);
    const manager = new DiaryAttachmentManager(
      {
        findById: () => Promise.resolve(entry),
        update,
      } as unknown as DiaryRepository,
      {
        findById: () => Promise.resolve(makeAnimal()),
      } as unknown as AnimalRepository,
      storage,
      { confirm } as unknown as AnimalMediaUploads,
    );
    await manager.confirmAttachment(
      animalId,
      entry.id.value,
      attachmentId,
      url,
      'foto.jpg',
      'image/jpeg',
      100,
    );
    expect(entry.toPrimitives()).toEqual(before);
    expect(update).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      ownerId,
      animalId,
      url,
      'image/jpeg',
      100,
    );
    const oldUrl = `${origin}/${key}/diary/${entry.id.value}/${attachmentId}.jpg`;
    await expect(
      manager.confirmAttachment(
        animalId,
        entry.id.value,
        attachmentId,
        oldUrl,
        'foto.jpg',
        'image/jpeg',
        100,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(entry.toPrimitives()).toEqual(before);
    expect(confirm).toHaveBeenCalledTimes(1);
    // A sealed URL is not an upload route for creating/recreating an attachment.
    entry.attachments = [];
    await expect(
      manager.confirmAttachment(
        animalId,
        entry.id.value,
        attachmentId,
        url,
        'foto.jpg',
        'image/jpeg',
        100,
      ),
    ).rejects.toThrow('must belong');
  });

  it('does not restore a retired legacy picture when a stale client confirms it after migration', async () => {
    const animal = makeAnimal();
    animal.profilePictureUrl = `${origin}/${key}/profile_200.jpeg`;
    const update = jest.fn();
    const deleteFile = jest.fn();
    const service = new UpdateAnimalProfilePictureUseCase(
      {
        findById: () => Promise.resolve(animal),
        update,
      } as unknown as AnimalRepository,
      {
        getFileKey: (url: string) => storage.getFileKey(url),
        deleteFile,
      } as unknown as IStorageService,
      {
        confirm: () =>
          Promise.reject(
            new ConflictError(
              'The media URL was migrated; refresh before confirming',
            ),
          ),
      } as unknown as AnimalMediaUploads,
    );
    await expect(
      service.run(animalId, `${origin}/${key}/profile_100.jpeg`),
    ).rejects.toThrow('URL was migrated');
    expect(animal.profilePictureUrl).toBe(`${origin}/${key}/profile_200.jpeg`);
    expect(update).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
