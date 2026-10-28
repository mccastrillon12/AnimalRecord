import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import {
  AnimalMediaUploadRepository,
  AnimalMediaUploadStorage,
} from '../../../src/context/animal-media/domain/animal-media-upload';
import {
  MEDIA_CONFIRMATION_JOURNAL_PROTOCOL,
  MediaConfirmationContext,
  mediaConfirmationContext,
} from '../../../src/context/animal-media/domain/media-confirmation-context';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { Animal } from '../../../src/context/animal/domain/animal';
import { DiaryAttachmentManager } from '../../../src/context/diary/application/diary-attachment-manager';
import { DiaryRepository } from '../../../src/context/diary/domain/diary-repository';
import { DiaryEntry } from '../../../src/context/diary/domain/diary-entry';
import { IStorageService } from '../../../src/context/user/domain/ports/IStorageService';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';
import {
  createWriteJournalFixture,
  withJournalAcquisition,
} from '../fixtures/animal-write-journal.fixture';

const animalId = id(1),
  ownerId = id(2);
const context = (
  kind: MediaConfirmationContext['kind'] = 'PROFILE_CONFIRM',
) => ({
  operationId: id(3),
  instanceId: id(4),
  animalId,
  ownerId,
  ownershipVersion: 2,
  kind,
});
const options = {
  kind: 'PROFILE_CONFIRM' as const,
  mediaPromotionProtocol: MEDIA_CONFIRMATION_JOURNAL_PROTOCOL,
} as const;

function setup() {
  const f = createWriteJournalFixture();
  const ownership = {
    findControl: jest.fn().mockResolvedValue({ ownerId, ownershipVersion: 2 }),
    beginWrite: jest.fn().mockResolvedValue(true),
    endWrite: jest.fn().mockResolvedValue(undefined),
    recordUploadWindow: jest.fn(),
  };
  const coordinator = new AnimalWriteCoordinator(
    {
      findWritableAnimal: jest.fn().mockResolvedValue({}),
    } as unknown as AnimalAccessPolicy,
    withJournalAcquisition(
      ownership,
      f,
    ) as unknown as AnimalOwnershipRepository,
    f.journal,
    f.instance,
  );
  return { ...f, coordinator, ownership };
}

describe('Media confirmation identity without a dispatch grant', () => {
  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'declares %s opt-in at creation and delivers only after acknowledged permission',
    async (kind) => {
      const f = setup();
      await f.coordinator.run(
        [animalId],
        ownerId,
        (received) => {
          const created = f.journal.create.mock.calls[0][0];
          expect(created).toMatchObject({
            callback: 'NOT_STARTED',
            mediaPromotionProtocol: MEDIA_CONFIRMATION_JOURNAL_PROTOCOL,
          });
          expect(f.entries.get(created.id)).toMatchObject({
            callback: 'MAY_RUN',
            claims: [{ state: 'ACQUIRED', ownershipVersion: 2 }],
          });
          expect(received).toEqual({
            ...context(kind),
            operationId: created.id,
            instanceId: f.instance.id,
          });
          expect(Object.isFrozen(received)).toBe(true);
          expect(f.ownership.endWrite).not.toHaveBeenCalled();
          return Promise.resolve(true);
        },
        { ...options, kind },
      );
    },
  );

  it('keeps ordinary callers unmarked and invokes them without arguments', async () => {
    const f = setup(),
      callback = jest.fn().mockResolvedValue('ok');
    await f.coordinator.run([animalId], ownerId, callback, {
      kind: 'PROFILE_CONFIRM',
    });
    expect(callback).toHaveBeenCalledWith();
    expect(f.journal.create.mock.calls[0][0]).not.toHaveProperty(
      'mediaPromotionProtocol',
    );
  });

  it('creates a new operation per HTTP attempt without reusing the retained identity', async () => {
    const f = setup(),
      seen: MediaConfirmationContext[] = [];
    const input = { ...options, issuesUploadUrl: false };
    const callback = (received?: MediaConfirmationContext) => {
      seen.push(received!);
      return Promise.resolve();
    };
    const first = f.coordinator.run([animalId], ownerId, callback, input);
    input.issuesUploadUrl = true;
    await first;
    await f.coordinator.run([animalId], ownerId, callback, options);
    expect(seen[0].operationId).not.toBe(seen[1].operationId);
    expect(f.ownership.recordUploadWindow).not.toHaveBeenCalled();
    for (const received of seen)
      expect(f.entries.get(received.operationId)?.lifecycle).toBe(
        'LOCALLY_FINISHED',
      );
    // Retaining an immutable context grants no new callback or remote send.
    expect(f.journal.permitCallback.mock.calls).toHaveLength(2);
  });

  it.each([
    { ...options, issuesUploadUrl: true },
    { ...options, kind: 'MEDICAL_POLL' },
    { ...options, mediaPromotionProtocol: 'future' },
  ])(
    'rejects incompatible opt-in before journal/claim/callback',
    async (input) => {
      const f = setup(),
        callback = jest.fn();
      await expect(
        f.coordinator.run(
          [animalId],
          ownerId,
          callback,
          input as typeof options,
        ),
      ).rejects.toThrow('opt-in');
      expect(f.journal.create.mock.calls).toHaveLength(0);
      expect(f.ownership.beginWrite).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it('rejects multi-animal opt-in without partial acquisition', async () => {
    const f = setup();
    await expect(
      f.coordinator.run([animalId, id(9)], ownerId, jest.fn(), options),
    ).rejects.toThrow('opt-in');
    expect(f.journal.create.mock.calls).toHaveLength(0);
  });

  it.each(['create', 'acquire', 'permit'] as const)(
    'never delivers context after uncertain %s',
    async (phase) => {
      const f = setup(),
        callback = jest.fn(),
        failure = new Error('uncertain acknowledgement');
      if (phase === 'create') f.journal.create.mockRejectedValueOnce(failure);
      if (phase === 'acquire')
        f.ownership.beginWrite.mockRejectedValueOnce(failure);
      if (phase === 'permit') {
        const permit = f.journal.permitCallback.getMockImplementation()!;
        f.journal.permitCallback.mockImplementationOnce(async (...args) => {
          await permit(...args);
          throw failure;
        });
      }
      await expect(
        f.coordinator.run([animalId], ownerId, callback, options),
      ).rejects.toBe(failure);
      expect(callback).not.toHaveBeenCalled();
      if (phase === 'permit')
        expect([...f.entries.values()][0].callbackPermittedAt).toBeDefined();
    },
  );

  it.each([
    { ownerId: id(90) },
    { animalId: id(91) },
    { kind: 'ATTACHMENT_CONFIRM' },
    { ownershipVersion: 0 },
    { operationId: 'bad' },
    { instanceId: 'bad' },
    { payload: 'private' },
  ])('rejects cross-scope or corrupt context %j', (change) => {
    expect(() =>
      mediaConfirmationContext(
        { ...context(), ...change } as MediaConfirmationContext,
        { animalId, ownerId, kind: 'PROFILE_CONFIRM' },
      ),
    ).toThrow();
  });

  function consumers() {
    const animal = Animal.fromPrimitives({
      ...archiveAnimal,
      id: animalId,
      ownerId,
    });
    const animals = {
      findById: jest.fn().mockResolvedValue(animal),
      update: jest.fn().mockResolvedValue(true),
    };
    const entry = DiaryEntry.create(animalId, 'Control');
    const diaries = {
      findById: jest.fn().mockResolvedValue(entry),
      update: jest.fn().mockResolvedValue(true),
    };
    const storage = {
      getFileKey: (url: string) => url,
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const confirm = jest
      .fn<Promise<void>, Parameters<AnimalMediaUploads['confirm']>>()
      .mockResolvedValue(undefined);
    return {
      animal,
      animals,
      entry,
      diaries,
      confirm,
      profile: new UpdateAnimalProfilePictureUseCase(
        animals as unknown as AnimalRepository,
        storage as unknown as IStorageService,
        { confirm } as unknown as AnimalMediaUploads,
      ),
      diary: new DiaryAttachmentManager(
        diaries as unknown as DiaryRepository,
        animals as unknown as AnimalRepository,
        storage as unknown as IStorageService,
        { confirm } as unknown as AnimalMediaUploads,
      ),
    };
  }

  it('copies context before a profile lookup awaits and forwards it to confirmation', async () => {
    const f = consumers(),
      input = context();
    const pending = f.profile.run(
      animalId,
      `users/${ownerId}/animals/${animalId}/profile_12.jpeg`,
      input,
    );
    input.operationId = id(80);
    await pending;
    const received = f.confirm.mock.calls[0][6];
    expect(received).toEqual(context());
    expect(Object.isFrozen(received)).toBe(true);
    expect(f.animals.update).toHaveBeenCalledTimes(1);
  });

  it.each(['new', 'identical'] as const)(
    'forwards diary %s confirmation and preserves idempotent metadata',
    async (phase) => {
      const f = consumers(),
        input = context('ATTACHMENT_CONFIRM');
      const url = `users/${ownerId}/animals/${animalId}/diary/${f.entry.id.value}/${id(9)}.jpg`;
      await f.diary.confirmAttachment(
        animalId,
        f.entry.id.value,
        id(9),
        url,
        'a.jpg',
        'image/jpeg',
        32,
        input,
      );
      if (phase === 'identical') {
        const before = f.entry.toPrimitives();
        await f.diary.confirmAttachment(
          animalId,
          f.entry.id.value,
          id(9),
          url,
          'a.jpg',
          'image/jpeg',
          32,
          input,
        );
        expect(f.entry.toPrimitives()).toEqual(before);
      }
      expect(
        f.confirm.mock.calls.every(
          (args) => JSON.stringify(args[6]) === JSON.stringify(input),
        ),
      ).toBe(true);
      expect(f.diaries.update).toHaveBeenCalledTimes(1);
    },
  );

  it('denies wrong owner before pin/promote or business writes', async () => {
    const f = consumers();
    await expect(
      f.profile.run(
        animalId,
        `users/${ownerId}/animals/${animalId}/profile_12.jpeg`,
        { ...context(), ownerId: id(99) },
      ),
    ).rejects.toThrow('context');
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.animals.update).not.toHaveBeenCalled();
  });

  it('checks scope before ticket reads, and preserves missing-ticket compatibility without inventing effects', async () => {
    const find = jest.fn().mockResolvedValue(null),
      promote = jest.fn();
    const uploads = new AnimalMediaUploads(
      {
        find,
        findLegacySource: jest.fn().mockResolvedValue(null),
      } as unknown as AnimalMediaUploadRepository,
      {
        keyFromUrl: (url: string) => url,
        promote,
      } as unknown as AnimalMediaUploadStorage,
    );
    const url = `users/${ownerId}/animals/${animalId}/profile_12.jpeg`;
    await expect(
      uploads.confirm(
        ownerId,
        animalId,
        url,
        undefined,
        undefined,
        undefined,
        context('ATTACHMENT_CONFIRM'),
      ),
    ).rejects.toThrow('context');
    expect(find).not.toHaveBeenCalled();
    await uploads.confirm(
      ownerId,
      animalId,
      url,
      undefined,
      undefined,
      undefined,
      context(),
    );
    expect(find).toHaveBeenCalledTimes(1);
    expect(promote).not.toHaveBeenCalled();
  });
});
