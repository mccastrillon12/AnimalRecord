import { Test } from '@nestjs/testing';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import { MediaPromotionConfirmationError } from '../../../src/context/animal-media/application/media-promotion-confirmation';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
  AnimalMediaUploadStorage,
} from '../../../src/context/animal-media/domain/animal-media-upload';
import {
  ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
  AnimalMediaPromotionConfirmation,
  PromotionConfirmationCall,
} from '../../../src/context/animal-media/domain/media-promotion-confirmation-runner';
import { promotionFixture } from '../fixtures/media-promotion.fixture';
import { Animal } from '../../../src/context/animal/domain/animal';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { DiaryEntry } from '../../../src/context/diary/domain/diary-entry';
import { DiaryRepository } from '../../../src/context/diary/domain/diary-repository';
import { DiaryAttachmentManager } from '../../../src/context/diary/application/diary-attachment-manager';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { IStorageService } from '../../../src/context/user/domain/ports/IStorageService';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

function setup(
  kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
) {
  const f = promotionFixture(kind);
  const ticket: AnimalMediaUpload = structuredClone(f.upload);
  const revision = { etag: '"final"', size: ticket.size, versionId: 'v1' };
  const repository = {
    create: jest.fn(),
    find: jest
      .fn<Promise<AnimalMediaUpload | null>, [string]>()
      .mockImplementation(() => Promise.resolve(ticket)),
    findLegacySource: jest
      .fn<Promise<AnimalMediaUpload | null>, [string]>()
      .mockResolvedValue(null),
    pin: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...ticket, pinned: f.upload.pinned }),
      ),
    seal: jest.fn().mockResolvedValue(undefined),
  } satisfies AnimalMediaUploadRepository;
  const storage = {
    keyFromUrl: jest.fn().mockReturnValue(ticket.finalKey),
    urlForKey: jest.fn(),
    signStaging: jest.fn(),
    describeSource: jest.fn(),
    pinSource: jest.fn().mockResolvedValue(f.upload.pinned),
    promote: jest.fn().mockResolvedValue(revision),
    verifyFinal: jest.fn().mockResolvedValue(revision),
  } satisfies AnimalMediaUploadStorage;
  const promotion = {
    confirm: jest
      .fn<Promise<void>, [PromotionConfirmationCall]>()
      .mockResolvedValue(undefined),
  } satisfies AnimalMediaPromotionConfirmation;
  const service = new AnimalMediaUploads(repository, storage, promotion);
  const scope = { ...f.initial.scope };
  const confirm = (selected = service, context = scope) =>
    selected.confirm(
      ticket.ownerId,
      ticket.animalId,
      'https://synthetic.invalid/media',
      ticket.mimeType,
      ticket.size,
      undefined,
      context,
    );
  const noOldCopy = () => {
    expect(storage.promote).not.toHaveBeenCalled();
    expect(repository.seal).not.toHaveBeenCalled();
  };
  return {
    ...f,
    ticket,
    revision,
    repository,
    storage,
    promotion,
    service,
    scope,
    confirm,
    noOldCopy,
  };
}

describe('Optional shared promotion bridge (no infrastructure)', () => {
  it.each([
    ['PROFILE_CONFIRM', false],
    ['PROFILE_CONFIRM', true],
    ['ATTACHMENT_CONFIRM', false],
    ['ATTACHMENT_CONFIRM', true],
  ] as const)(
    'only writes business references after %s succeeds, failure=%s',
    async (kind, failure) => {
      const f = setup(kind);
      const animal = Animal.fromPrimitives({
        ...archiveAnimal,
        id: f.animalId,
        ownerId: f.ticket.ownerId,
      });
      const entry = DiaryEntry.create(f.animalId, 'Control');
      if (kind === 'ATTACHMENT_CONFIRM') {
        f.ticket.finalKey = `users/${f.ticket.ownerId}/animals/${f.animalId}/diary/${entry.id.value}/${f.id(9)}.m4a`;
        f.storage.keyFromUrl.mockReturnValue(f.ticket.finalKey);
      }
      const animals = {
        findById: jest.fn().mockResolvedValue(animal),
        update: jest.fn().mockResolvedValue(true),
      };
      const diaries = {
        findById: jest.fn().mockResolvedValue(entry),
        update: jest.fn().mockResolvedValue(true),
      };
      const storage = {
        getFileKey: (url: string) => url,
        deleteFile: jest.fn().mockResolvedValue(undefined),
      };
      const beforeAnimal = animal.toPrimitives(),
        beforeEntry = entry.toPrimitives();
      f.promotion.confirm.mockImplementation(() => {
        expect(animals.update).not.toHaveBeenCalled();
        expect(diaries.update).not.toHaveBeenCalled();
        return failure
          ? Promise.reject(
              new MediaPromotionConfirmationError('SEAL', 'UNCERTAIN'),
            )
          : Promise.resolve();
      });
      const promise =
        kind === 'PROFILE_CONFIRM'
          ? new UpdateAnimalProfilePictureUseCase(
              animals as unknown as AnimalRepository,
              storage as unknown as IStorageService,
              f.service,
            ).run(f.animalId, f.ticket.finalKey, f.scope)
          : new DiaryAttachmentManager(
              diaries as unknown as DiaryRepository,
              animals as unknown as AnimalRepository,
              storage as unknown as IStorageService,
              f.service,
            ).confirmAttachment(
              f.animalId,
              entry.id.value,
              f.id(9),
              f.ticket.finalKey,
              'audio.m4a',
              f.ticket.mimeType,
              f.ticket.size,
              f.scope,
            );
      if (failure) {
        await expect(promise).rejects.toMatchObject({
          stage: 'SEAL',
          reason: 'UNCERTAIN',
        });
        expect(animals.update).not.toHaveBeenCalled();
        expect(diaries.update).not.toHaveBeenCalled();
        expect(storage.deleteFile).not.toHaveBeenCalled();
        expect(animal.toPrimitives()).toEqual(beforeAnimal);
        expect(entry.toPrimitives()).toEqual(beforeEntry);
      } else {
        await expect(promise).resolves.toBeUndefined();
        expect(
          kind === 'PROFILE_CONFIRM' ? animals.update : diaries.update,
        ).toHaveBeenCalledTimes(1);
      }
      expect(f.promotion.confirm).toHaveBeenCalledTimes(1);
      expect(f.promotion.confirm.mock.calls[0][0].scope).toEqual(f.scope);
      f.noOldCopy();
    },
  );

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'pins %s before the selected cycle and creates separate backend identities',
    async (kind) => {
      const f = setup(kind);
      delete f.ticket.pinned;
      f.promotion.confirm.mockImplementation((call) => {
        expect(f.repository.pin).toHaveBeenCalledWith(
          f.ticket.finalKey,
          f.upload.pinned,
        );
        expect(call.scope).toEqual(f.scope);
        expect(call.uploadId).toBe(f.ticket.id);
        expect(Object.isFrozen(call)).toBe(true);
        expect(Object.isFrozen(call.scope)).toBe(true);
        expect(
          new Set([
            call.effectId,
            call.dispatcherInstanceId,
            call.observationId,
            call.scope.operationId,
            call.scope.instanceId,
            call.uploadId,
          ]).size,
        ).toBe(6);
        return Promise.resolve();
      });
      await expect(f.confirm()).resolves.toBeUndefined();
      expect(f.promotion.confirm).toHaveBeenCalledTimes(1);
      f.noOldCopy();
    },
  );

  it('retains the current promotion/seal without the optional port or context', async () => {
    const f = setup();
    await new AnimalMediaUploads(f.repository, f.storage).confirm(
      f.ticket.ownerId,
      f.animalId,
      'https://synthetic.invalid/media',
    );
    expect(f.storage.promote).toHaveBeenCalledWith(f.ticket);
    expect(f.repository.seal).toHaveBeenCalledWith(
      f.ticket.finalKey,
      f.ticket.pinned!.sha256,
      f.revision,
    );
    expect(f.promotion.confirm).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'resolves Nest dependencies with selection=%s without external modules',
    async (selected) => {
      const f = setup();
      const module = await Test.createTestingModule({
        providers: [
          AnimalMediaUploads,
          { provide: 'AnimalMediaUploadRepository', useValue: f.repository },
          { provide: 'AnimalMediaUploadStorage', useValue: f.storage },
          ...(selected
            ? [
                {
                  provide: ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
                  useValue: f.promotion,
                },
              ]
            : []),
        ],
      }).compile();
      try {
        await f.confirm(module.get(AnimalMediaUploads));
        expect(f.promotion.confirm).toHaveBeenCalledTimes(selected ? 1 : 0);
        expect(f.storage.promote).toHaveBeenCalledTimes(selected ? 0 : 1);
      } finally {
        await module.close();
      }
    },
  );

  it.each([false, true])(
    'requires backend context before pin/copy, pinned=%s',
    async (pinned) => {
      const f = setup();
      if (!pinned) delete f.ticket.pinned;
      await expect(
        f.service.confirm(
          f.ticket.ownerId,
          f.animalId,
          'https://synthetic.invalid/media',
        ),
      ).rejects.toMatchObject({ stage: 'INPUT', reason: 'UNAVAILABLE' });
      expect(f.storage.pinSource).not.toHaveBeenCalled();
      expect(f.repository.pin).not.toHaveBeenCalled();
      expect(f.promotion.confirm).not.toHaveBeenCalled();
      f.noOldCopy();
    },
  );

  it('copies caller context before repository awaits', async () => {
    const f = setup(),
      original = { ...f.scope };
    const promise = f.confirm();
    f.scope.operationId = f.id(99);
    f.scope.ownershipVersion = 99;
    await promise;
    expect(f.promotion.confirm.mock.calls[0][0].scope).toEqual(original);
  });

  it.each([
    { ownerId: 'other' },
    { kind: 'ATTACHMENT_CONFIRM' },
    { payload: 'private' },
  ])('rejects invalid backend scope %j before reads', async (change) => {
    const f = setup();
    await expect(
      f.confirm(f.service, { ...f.scope, ...change } as typeof f.scope),
    ).rejects.toThrow('context');
    expect(f.repository.findLegacySource).not.toHaveBeenCalled();
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it('keeps the existing no-ticket confirmation compatibility', async () => {
    const f = setup();
    f.repository.find.mockResolvedValueOnce(null);
    await expect(
      f.service.confirm(
        f.ticket.ownerId,
        f.animalId,
        'https://synthetic.invalid/media',
      ),
    ).resolves.toBeUndefined();
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it('rejects a migrated source URL before selecting any promotion', async () => {
    const f = setup();
    f.repository.findLegacySource.mockResolvedValueOnce(f.ticket);
    await expect(f.confirm()).rejects.toThrow('migrated');
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it.each([false, true])(
    'preserves the migration current-reference guard, current=%s',
    async (current) => {
      const f = setup();
      f.ticket.legacy = {
        migrationId: f.id(20),
        sourceUrl: 'https://synthetic.invalid/source',
        kind: 'PROFILE',
      };
      const promise = f.service.confirm(
        f.ticket.ownerId,
        f.animalId,
        'https://synthetic.invalid/media',
        undefined,
        undefined,
        current ? 'https://synthetic.invalid/media' : undefined,
      );
      if (current) {
        await expect(promise).resolves.toBeUndefined();
        expect(f.storage.promote).toHaveBeenCalledWith(f.ticket);
        expect(f.repository.seal).toHaveBeenCalled();
      } else {
        await expect(promise).rejects.toThrow('not the current');
        f.noOldCopy();
      }
      expect(f.promotion.confirm).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'verifies an already sealed ticket without opening a cycle, sealed during pin=%s',
    async (duringPin) => {
      const f = setup();
      if (duringPin) {
        delete f.ticket.pinned;
        f.repository.pin.mockResolvedValueOnce({
          ...f.ticket,
          pinned: f.upload.pinned,
          sealed: f.revision,
        });
      } else f.ticket.sealed = f.revision;
      await f.confirm();
      expect(f.storage.verifyFinal).toHaveBeenCalledTimes(1);
      expect(f.promotion.confirm).not.toHaveBeenCalled();
      f.noOldCopy();
    },
  );

  it('keeps sealed-ticket verification available without new backend context', async () => {
    const f = setup();
    f.ticket.sealed = f.revision;
    await f.service.confirm(
      f.ticket.ownerId,
      f.animalId,
      'https://synthetic.invalid/media',
    );
    expect(f.storage.verifyFinal).toHaveBeenCalled();
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it('rejects mismatched upload metadata without starting the selected cycle', async () => {
    const f = setup();
    await expect(
      f.service.confirm(
        f.ticket.ownerId,
        f.animalId,
        'https://synthetic.invalid/media',
        'wrong',
        undefined,
        undefined,
        f.scope,
      ),
    ).rejects.toThrow('metadata');
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it('never selects a cycle after source pin failure', async () => {
    const f = setup();
    delete f.ticket.pinned;
    f.storage.pinSource.mockRejectedValueOnce(
      new Error('synthetic pin failure'),
    );
    await expect(f.confirm()).rejects.toThrow('pin failure');
    expect(f.promotion.confirm).not.toHaveBeenCalled();
    f.noOldCopy();
  });

  it.each([
    new MediaPromotionConfirmationError('VERIFY', 'CONFLICT'),
    new MediaPromotionConfirmationError('INSPECT', 'UNAVAILABLE'),
    new MediaPromotionConfirmationError('SEAL', 'UNCERTAIN'),
    new Error('secret provider URL and credentials'),
  ])(
    'retains private immutable correlation and never falls back after %s',
    async (failure) => {
      const f = setup();
      f.promotion.confirm.mockRejectedValueOnce(failure);
      const error: unknown = await f.confirm().catch((e: unknown) => e);
      const call = f.promotion.confirm.mock.calls[0][0];
      expect(error).toBeInstanceOf(MediaPromotionConfirmationError);
      expect(error).toMatchObject({
        stage:
          failure instanceof MediaPromotionConfirmationError
            ? failure.stage
            : 'DISPATCH',
        reason:
          failure instanceof MediaPromotionConfirmationError
            ? failure.reason
            : 'UNCERTAIN',
        receipt: {
          operationId: f.scope.operationId,
          instanceId: f.scope.instanceId,
          animalId: f.animalId,
          uploadId: f.ticket.id,
          effectId: call.effectId,
          dispatcherInstanceId: call.dispatcherInstanceId,
          observationId: call.observationId,
        },
      });
      const captured = error as MediaPromotionConfirmationError;
      expect(Object.isFrozen(captured.receipt)).toBe(true);
      expect(captured).not.toHaveProperty('cause');
      expect(JSON.stringify(captured)).not.toMatch(/secret|credentials|https:/);
      f.noOldCopy();
    },
  );

  it('generates new attempt correlation on a separate invocation without replaying retained IDs', async () => {
    const f = setup();
    f.promotion.confirm.mockRejectedValue(
      new MediaPromotionConfirmationError('OPEN', 'CONFLICT'),
    );
    await expect(f.confirm()).rejects.toThrow(MediaPromotionConfirmationError);
    await expect(f.confirm()).rejects.toThrow(MediaPromotionConfirmationError);
    const calls = f.promotion.confirm.mock.calls.map(([call]) => call);
    expect(
      new Set(
        calls.flatMap((call) => [
          call.effectId,
          call.dispatcherInstanceId,
          call.observationId,
        ]),
      ).size,
    ).toBe(6);
    expect(calls[0].scope).toEqual(calls[1].scope);
    // Only the real cycle can create grants. Reusing a scope does not authorize a send.
    f.noOldCopy();
  });
});
