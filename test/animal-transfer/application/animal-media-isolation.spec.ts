import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
} from '../../../src/context/animal-media/domain/animal-media-upload';
import { AwsAnimalMediaUploadStorage } from '../../../src/context/animal-media/infrastructure/aws-animal-media-upload-storage';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { AwsS3StorageService } from '../../../src/context/shared/infrastructure/storage/aws-s3-storage.service';
import { LegacyAnimalMediaCopier } from '../../../src/context/animal-media/application/legacy-animal-media-copier';
import {
  LegacyMediaReference,
  MediaMigration,
} from '../../../src/context/animal-media/domain/legacy-media-migration';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { Animal } from '../../../src/context/animal/domain/animal';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

type StoredObject = {
  bytes: Buffer;
  etag: string;
  versionId?: string;
  mimeType: string;
  metadata: Record<string, string>;
};
const ownerId = '123e4567-e89b-42d3-a456-426614174001';
const animalId = '123e4567-e89b-42d3-a456-426614174010';
const prefix = `users/${ownerId}/animals/${animalId}/`;
const finalKey = `${prefix}profile_100.jpeg`;
const origin = 'https://test-bucket.s3.us-east-1.amazonaws.com';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('Animal media isolation: real service/adapter, simulated S3 and Mongo', () => {
  let mock: jest.SpyInstance;
  afterEach(() => mock?.mockRestore());

  const setup = (versioned = true) => {
    const tickets = new Map<string, AnimalMediaUpload>();
    const objects = new Map<string, StoredObject>();
    const versions = new Map<string, StoredObject>();
    const commands: Array<
      CopyObjectCommand | GetObjectCommand | HeadObjectCommand
    > = [];
    let copyTimeout = false;
    let corruptCopy = false;
    let delayedCopy: (() => void) | undefined;
    let delayCopy = false;
    let sequence = 0;
    const put = (
      key: string,
      bytes = Buffer.from('file'),
      mimeType = 'image/jpeg',
      metadata: Record<string, string> = {},
    ) => {
      const object: StoredObject = {
        bytes: Buffer.from(bytes),
        etag: `etag-${++sequence}`,
        versionId: versioned ? `version/${sequence}` : undefined,
        mimeType,
        metadata,
      };
      objects.set(key, object);
      if (object.versionId) versions.set(object.versionId, object);
    };
    const error = (code: number) =>
      Object.assign(new Error(`S3 ${code}`), {
        $metadata: { httpStatusCode: code },
      });
    const send = jest.fn(
      (command: CopyObjectCommand | GetObjectCommand | HeadObjectCommand) => {
        commands.push(command);
        const key = command.input.Key!;
        const object =
          command instanceof GetObjectCommand && command.input.VersionId
            ? versions.get(command.input.VersionId)
            : objects.get(key);
        if (command instanceof HeadObjectCommand) {
          if (!object) return Promise.reject(error(404));
          return Promise.resolve({
            ETag: object.etag,
            VersionId: object.versionId,
            ContentLength: object.bytes.length,
            ContentType: object.mimeType,
            Metadata: object.metadata,
          });
        }
        if (command instanceof GetObjectCommand) {
          if (!object) return Promise.reject(error(404));
          if (
            command.input.IfMatch !== object.etag ||
            (command.input.VersionId &&
              command.input.VersionId !== object.versionId)
          )
            return Promise.reject(error(412));
          return Promise.resolve({
            Body: Readable.from([Buffer.from(object.bytes)]),
          });
        }
        const sourceKey = command.input
          .CopySource!.split('?')[0]
          .split('/')
          .slice(1)
          .map(decodeURIComponent)
          .join('/');
        const sourceVersion = new URLSearchParams(
          command.input.CopySource!.split('?')[1] ?? '',
        ).get('versionId');
        const complete = () => {
          const source = sourceVersion
            ? versions.get(sourceVersion)
            : objects.get(sourceKey);
          if (
            objects.has(key) ||
            !source ||
            source.etag !== command.input.CopySourceIfMatch
          )
            throw error(412);
          const bytes = Buffer.from(source.bytes);
          if (corruptCopy) bytes[0] ^= 1;
          put(key, bytes, command.input.ContentType, command.input.Metadata);
        };
        if (delayCopy) {
          delayedCopy = complete;
          return Promise.reject(error(503));
        }
        try {
          complete();
        } catch (failure) {
          return Promise.reject(
            failure instanceof Error ? failure : new Error('Copy failed'),
          );
        }
        if (copyTimeout) return Promise.reject(error(503));
        return Promise.resolve({
          CopyObjectResult: { ETag: objects.get(key)!.etag },
          VersionId: objects.get(key)!.versionId,
        });
      },
    );
    mock = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(send as never);
    const repository: jest.Mocked<AnimalMediaUploadRepository> = {
      create: jest.fn((ticket) => {
        if (
          tickets.has(ticket.finalKey) ||
          [...tickets.values()].some((t) => t.stagingKey === ticket.stagingKey)
        )
          return Promise.reject(new ConflictError('Duplicate destination'));
        tickets.set(ticket.finalKey, clone(ticket));
        return Promise.resolve();
      }),
      find: jest.fn((key) => Promise.resolve(clone(tickets.get(key) ?? null))),
      findLegacySource: jest.fn((key) =>
        Promise.resolve(
          clone(
            [...tickets.values()].find(
              (t) => t.stagingKey === key && t.legacy,
            ) ?? null,
          ),
        ),
      ),
      pin: jest.fn((key, source) => {
        const ticket = tickets.get(key)!;
        ticket.pinned ??= clone(source);
        return Promise.resolve(clone(ticket));
      }),
      seal: jest.fn((key, sha256, revision) => {
        const ticket = tickets.get(key)!;
        if (ticket.pinned?.sha256 !== sha256)
          return Promise.reject(new Error('Wrong digest'));
        ticket.sealed ??= clone(revision);
        return Promise.resolve();
      }),
    };
    const config = {
      getAwsS3BucketName: () => 'test-bucket',
      getAwsS3Region: () => 'us-east-1',
    } as EnvironmentConfigService;
    const urls = new AwsS3StorageService(config);
    const signer = jest
      .spyOn(urls, 'generatePreSignedUploadUrl')
      .mockImplementation((key) =>
        Promise.resolve({
          uploadUrl: `https://signed.test/${key}`,
          finalUrl: `${origin}/${key}`,
        }),
      );
    const storage = new AwsAnimalMediaUploadStorage(config, urls);
    const service = new AnimalMediaUploads(repository, storage);
    const instance = () => new AnimalMediaUploads(repository, storage);
    const issue = () =>
      service.issue(ownerId, animalId, finalKey, 'image/jpeg', 4);
    const upload = () => put(tickets.get(finalKey)!.stagingKey);
    const confirm = () =>
      service.confirm(ownerId, animalId, `${origin}/${finalKey}`);
    return {
      service,
      instance,
      storage,
      repository,
      tickets,
      objects,
      commands,
      signer,
      issue,
      upload,
      confirm,
      put,
      timeout: () => {
        copyTimeout = true;
      },
      corrupt: () => {
        corruptCopy = true;
      },
      delay: () => {
        delayCopy = true;
      },
      finishDelayed: () => delayedCopy!(),
    };
  };

  const migration: MediaMigration = {
    id: '123e4567-e89b-42d3-a456-426614174020',
    ownerId,
    animalId,
    ownershipVersion: 1,
    phase: 'PROFILE',
    revision: 0,
  };
  const profile: LegacyMediaReference = {
    kind: 'PROFILE',
    url: `${origin}/${finalKey}`,
  };

  it('migrates a legacy picture without signing PUT or deleting its original, and rejects later confirmations of the retired URL', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    const url = await copier.prepare(migration, profile);
    const key = ctx.storage.keyFromUrl(url)!;
    expect(key).not.toBe(finalKey);
    expect(key).toMatch(/profile_\d+\.jpeg$/);
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    ctx.put(finalKey, Buffer.from('late'));
    expect(ctx.objects.get(key)!.bytes.toString()).toBe('file');
    await expect(copier.prepare(migration, profile)).resolves.toBe(url);
    await expect(
      ctx.service.confirm(ownerId, animalId, url, undefined, undefined, url),
    ).resolves.toBeUndefined();
    await expect(ctx.confirm()).rejects.toThrow('URL was migrated');
    expect(ctx.signer).not.toHaveBeenCalled();
    await expect(
      ctx.storage.signStaging(ctx.tickets.get(key)!),
    ).rejects.toThrow('cannot issue PUT');
    await expect(ctx.service.inspectSealed(key)).resolves.toMatchObject({
      size: 4,
    });
  });

  it('preserves diary attachment identity and metadata with a distinct canonical sealed URL', async () => {
    const ctx = setup();
    const entryId = '123e4567-e89b-42d3-a456-426614174021';
    const attachmentId = '123e4567-e89b-42d3-a456-426614174022';
    const source = `${prefix}diary/${entryId}/${attachmentId}.m4a`;
    ctx.put(source, Buffer.from('file'), 'audio/mp4');
    const ref: LegacyMediaReference = {
      kind: 'DIARY',
      entryId,
      attachmentId,
      url: `${origin}/${source}`,
      mimeType: 'audio/mp4',
      size: 4,
    };
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    const url = await copier.prepare(migration, ref);
    expect(url).toContain(`/diary/${entryId}/${attachmentId}/sealed_`);
    const ticket = ctx.tickets.get(ctx.storage.keyFromUrl(url)!)!;
    expect(ticket).toMatchObject({
      stagingKey: source,
      mimeType: 'audio/mp4',
      size: 4,
      legacy: {
        migrationId: migration.id,
        entryId,
        attachmentId,
        sourceUrl: ref.url,
      },
    });
    await expect(copier.prepare(migration, { ...ref, url })).resolves.toBe(url);
    await expect(
      copier.prepare(migration, { ...ref, size: 5 }),
    ).rejects.toThrow('metadata');
    await expect(
      copier.prepare(migration, { ...ref, mimeType: undefined }),
    ).rejects.toThrow('invalid MIME');
  });

  it('reconciles a migration copy whose success response was lost and does not issue another ticket', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    ctx.timeout();
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    await expect(copier.prepare(migration, profile)).rejects.toThrow(
      'retry the same',
    );
    expect(ctx.tickets.size).toBe(1);
    const url = await new LegacyAnimalMediaCopier(
      ctx.repository,
      ctx.storage,
    ).prepare(migration, profile);
    expect(ctx.tickets.size).toBe(1);
    expect(ctx.tickets.get(ctx.storage.keyFromUrl(url)!)!.sealed).toBeDefined();
    expect(ctx.objects.has(finalKey)).toBe(true);
  });

  it('keeps the same pinned legacy revision when an old PUT changes the unversioned source before copying', async () => {
    const ctx = setup(false);
    ctx.put(finalKey);
    const promote = ctx.storage.promote.bind(ctx.storage);
    jest.spyOn(ctx.storage, 'promote').mockImplementationOnce((upload) => {
      ctx.put(finalKey, Buffer.from('late'));
      return promote(upload);
    });
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    await expect(copier.prepare(migration, profile)).rejects.toThrow(
      'staged upload changed',
    );
    const ticket = [...ctx.tickets.values()][0];
    const pinned = clone(ticket.pinned);
    expect(ticket.sealed).toBeUndefined();
    await expect(copier.prepare(migration, profile)).rejects.toThrow(
      'staged upload changed',
    );
    expect([...ctx.tickets.values()][0].pinned).toEqual(pinned);
    expect(ctx.objects.has(ticket.finalKey)).toBe(false);
  });

  it('rejects foreign, missing, conflicting and unconfirmed sources instead of blessing them as legacy', async () => {
    const ctx = setup();
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    await expect(
      copier.prepare(migration, {
        ...profile,
        url: profile.url.replace(ownerId, animalId),
      }),
    ).rejects.toThrow('expected owner');
    await expect(copier.prepare(migration, profile)).rejects.toThrow('missing');
    await ctx.issue();
    ctx.upload();
    await expect(copier.prepare(migration, profile)).rejects.toThrow(
      'unconfirmed',
    );
    expect(ctx.repository.pin.mock.calls).toHaveLength(0);
  });

  it('concurrent migration workers converge on one ticket and one immutable destination', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    const urls = await Promise.all([
      copier.prepare(migration, profile),
      copier.prepare(migration, profile),
    ]);
    expect(new Set(urls).size).toBe(1);
    expect(ctx.tickets.size).toBe(1);
    expect(ctx.objects.size).toBe(2);
  });

  it('a versioned legacy source changed during copying still produces the pinned bytes, not the later PUT', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    const promote = ctx.storage.promote.bind(ctx.storage);
    jest.spyOn(ctx.storage, 'promote').mockImplementationOnce((upload) => {
      ctx.put(finalKey, Buffer.from('late'));
      return promote(upload);
    });
    const url = await new LegacyAnimalMediaCopier(
      ctx.repository,
      ctx.storage,
    ).prepare(migration, profile);
    expect(
      ctx.objects.get(ctx.storage.keyFromUrl(url)!)!.bytes.toString(),
    ).toBe('file');
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('late');
  });

  it('a late migration copy cannot be activated through ordinary confirmation after technical stop', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    ctx.delay();
    const copier = new LegacyAnimalMediaCopier(ctx.repository, ctx.storage);
    await expect(copier.prepare(migration, profile)).rejects.toThrow(
      'retry the same',
    );
    const ticket = [...ctx.tickets.values()][0];
    const url = ctx.storage.urlForKey(ticket.finalKey);
    // STOPPED fences Mongo reference activation; the already dispatched remote
    // copy can still complete. No cancellation or TTL is assumed here.
    ctx.finishDelayed();
    const animal = Animal.fromPrimitives({
      ...archiveAnimal,
      profilePictureUrl: profile.url,
    });
    const before = animal.toPrimitives();
    const update = jest.fn();
    const deleteFile = jest.fn();
    const confirm = new UpdateAnimalProfilePictureUseCase(
      { findById: () => Promise.resolve(animal), update } as never,
      {
        getFileKey: ctx.storage.keyFromUrl.bind(ctx.storage),
        deleteFile,
      } as never,
      ctx.service,
    );
    await expect(confirm.run(animalId, url)).rejects.toThrow(
      'not the current media',
    );
    expect(animal.toPrimitives()).toEqual(before);
    expect(update).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(ctx.tickets.get(ticket.finalKey)!.sealed).toBeUndefined();
    expect(ctx.objects.get(ticket.finalKey)!.bytes.toString()).toBe('file');
  });

  it('an activated migrated picture remains idempotent but cannot displace a newer picture', async () => {
    const ctx = setup();
    ctx.put(finalKey);
    const url = await new LegacyAnimalMediaCopier(
      ctx.repository,
      ctx.storage,
    ).prepare(migration, profile);
    const animal = Animal.fromPrimitives({
      ...archiveAnimal,
      profilePictureUrl: url,
    });
    const update = jest.fn();
    const deleteFile = jest.fn();
    const confirm = new UpdateAnimalProfilePictureUseCase(
      { findById: () => Promise.resolve(animal), update } as never,
      {
        getFileKey: ctx.storage.keyFromUrl.bind(ctx.storage),
        deleteFile,
      } as never,
      ctx.service,
    );
    await confirm.run(animalId, url);
    expect(update).not.toHaveBeenCalled();
    animal.profilePictureUrl = `${origin}/${prefix}profile_999.jpeg`;
    await expect(confirm.run(animalId, url)).rejects.toThrow(
      'not the current media',
    );
    expect(update).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('durably issues an isolated URL, preserving the public fields and final hierarchy, and publishes only after confirmation', async () => {
    const ctx = setup();
    const result = await ctx.issue();
    const ticket = ctx.tickets.get(finalKey)!;
    expect(Object.keys(result).sort()).toEqual(['finalUrl', 'uploadUrl']);
    expect(result.finalUrl).toBe(`${origin}/${finalKey}`);
    expect(result.uploadUrl).toContain(`/upload-intake/${ticket.id}/source`);
    expect(ctx.signer).toHaveBeenCalledWith(ticket.stagingKey, 'image/jpeg', 4);
    expect(ctx.repository.create.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.signer.mock.invocationCallOrder[0],
    );
    ctx.upload();
    expect(ctx.objects.has(finalKey)).toBe(false);
    await ctx.confirm();
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    const copy = ctx.commands.find(
      (command) => command instanceof CopyObjectCommand,
    ) as CopyObjectCommand;
    expect(copy.input.IfNoneMatch).toBe('*');
    expect(copy.input.CopySourceIfMatch).toBe(
      ctx.tickets.get(finalKey)!.pinned!.etag,
    );
    expect(copy.input.CopySource).toContain('?versionId=version%2F');
    await expect(ctx.service.inspectSealed(finalKey)).resolves.toMatchObject(
      ctx.tickets.get(finalKey)!.sealed!,
    );
  });

  it('late/repeated PUT only alters intake, not the confirmed object or the transfer source', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    await ctx.confirm();
    const confirmed = clone(ctx.tickets.get(finalKey)!.sealed!);
    ctx.put(ctx.tickets.get(finalKey)!.stagingKey, Buffer.from('evil'));
    await ctx.instance().confirm(ownerId, animalId, `${origin}/${finalKey}`);
    await expect(ctx.service.inspectSealed(finalKey)).resolves.toEqual(
      confirmed,
    );
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(1);
  });

  it('reconciles a copy that completed but lost its response without recopying or deleting either object', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    ctx.timeout();
    await expect(ctx.confirm()).rejects.toThrow('retry the same confirmation');
    expect(ctx.tickets.get(finalKey)!.sealed).toBeUndefined();
    expect(ctx.objects.has(finalKey)).toBe(true);
    ctx.put(ctx.tickets.get(finalKey)!.stagingKey, Buffer.from('late'));
    await ctx.instance().confirm(ownerId, animalId, `${origin}/${finalKey}`);
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(1);
    expect(ctx.objects.size).toBe(2);
  });

  it('does not mark a timed-out copy sealed before it completes; recovery uses the immutable result', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    ctx.delay();
    await expect(ctx.confirm()).rejects.toThrow('retry the same confirmation');
    await expect(ctx.service.assertRegisteredSealed(finalKey)).rejects.toThrow(
      'must be migrated',
    );
    expect(ctx.objects.has(finalKey)).toBe(false);
    ctx.finishDelayed();
    await ctx.instance().confirm(ownerId, animalId, `${origin}/${finalKey}`);
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
  });

  it('recovers after final verification succeeded but sealing acknowledgement failed', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    ctx.repository.seal.mockRejectedValueOnce(
      new Error('Mongo acknowledgement lost'),
    );
    await expect(ctx.confirm()).rejects.toThrow('Mongo acknowledgement lost');
    await ctx.instance().confirm(ownerId, animalId, `${origin}/${finalKey}`);
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(1);
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
  });

  it('coordinates concurrent confirmations around one pinned source and never overwrites the final', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    await Promise.all([
      ctx.confirm(),
      ctx.instance().confirm(ownerId, animalId, `${origin}/${finalKey}`),
    ]);
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    for (const command of ctx.commands.filter(
      (command) => command instanceof CopyObjectCommand,
    ))
      expect(command.input.IfNoneMatch).toBe('*');
  });

  it('uses the already pinned winning source rather than a losing concurrent candidate', async () => {
    const ctx = setup(false);
    await ctx.issue();
    ctx.upload();
    const winner = await ctx.storage.pinSource(ctx.tickets.get(finalKey)!);
    await ctx.repository.pin(finalKey, winner);
    ctx.put(ctx.tickets.get(finalKey)!.stagingKey, Buffer.from('evil'));
    await expect(ctx.confirm()).rejects.toThrow('staged upload changed');
    expect(ctx.objects.has(finalKey)).toBe(false);
    expect(ctx.tickets.get(finalKey)!.pinned).toEqual(winner);
    expect(ctx.tickets.get(finalKey)!.sealed).toBeUndefined();
  });

  it('rejects missing uploads and wrong actual size/MIME before any copy', async () => {
    const ctx = setup();
    await ctx.issue();
    await expect(ctx.confirm()).rejects.toThrow('not available yet');
    ctx.put(ctx.tickets.get(finalKey)!.stagingKey, Buffer.from('wrong size'));
    await expect(ctx.confirm()).rejects.toThrow('size or MIME');
    ctx.put(
      ctx.tickets.get(finalKey)!.stagingKey,
      Buffer.from('file'),
      'audio/mpeg',
    );
    await expect(ctx.confirm()).rejects.toThrow('size or MIME');
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(0);
  });

  it('rejects forged confirmation metadata, wrong owner and foreign URLs', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    await expect(
      ctx.service.confirm(
        ownerId,
        animalId,
        `${origin}/${finalKey}`,
        'audio/mpeg',
        4,
      ),
    ).rejects.toThrow('metadata does not match');
    await expect(
      ctx.service.confirm(
        ownerId,
        animalId,
        `${origin}/${finalKey}`,
        'image/jpeg',
        5,
      ),
    ).rejects.toThrow('metadata does not match');
    await expect(
      ctx.service.confirm('other', animalId, `${origin}/${finalKey}`),
    ).rejects.toThrow('must belong');
    await expect(
      ctx.service.confirm(ownerId, animalId, 'https://foreign.test/file'),
    ).rejects.toThrow('must belong');
    expect(ctx.commands).toHaveLength(0);
  });

  it('does not overwrite an unrelated existing final and detects same-size copy corruption', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    ctx.put(finalKey, Buffer.from('evil'));
    await expect(ctx.confirm()).rejects.toThrow(
      'conflicting content or provenance',
    );
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(0);
    ctx.objects.delete(finalKey);
    ctx.corrupt();
    await expect(ctx.confirm()).rejects.toThrow(
      'integrity verification failed',
    );
    expect(ctx.tickets.get(finalKey)!.sealed).toBeUndefined();
  });

  it('rechecks a ticket sealed by another confirmation during source pinning and does not resurrect its deleted final', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    const originalPin = ctx.repository.pin.getMockImplementation()!;
    ctx.repository.pin.mockImplementationOnce(async (key, source) => {
      const upload = await originalPin(key, source);
      const sealed = await ctx.storage.promote(upload);
      ctx.tickets.get(key)!.sealed = sealed;
      ctx.objects.delete(finalKey);
      return { ...upload, sealed };
    });
    await expect(ctx.confirm()).rejects.toThrow(
      'confirmed upload is unavailable',
    );
    expect(ctx.objects.has(finalKey)).toBe(false);
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(1);
  });

  it('keeps a pinned version available when staging is overwritten in a versioned bucket', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    const pinned = await ctx.storage.pinSource(ctx.tickets.get(finalKey)!);
    await ctx.repository.pin(finalKey, pinned);
    ctx.put(ctx.tickets.get(finalKey)!.stagingKey, Buffer.from('late'));
    await ctx.confirm();
    expect(ctx.objects.get(finalKey)!.bytes.toString()).toBe('file');
    expect(ctx.tickets.get(finalKey)!.sealed).toBeDefined();
  });

  it('never recreates deleted sealed media from staging or recycles its ticket', async () => {
    const ctx = setup();
    await ctx.issue();
    ctx.upload();
    await ctx.confirm();
    ctx.objects.delete(finalKey);
    await expect(ctx.confirm()).rejects.toThrow(
      'confirmed upload is unavailable',
    );
    expect(
      ctx.commands.filter((command) => command instanceof CopyObjectCommand),
    ).toHaveLength(1);
    await expect(ctx.issue()).rejects.toThrow('Duplicate destination');
  });

  it('keeps legacy confirmation compatible but refuses legacy/unsealed media as transfer sources', async () => {
    const ctx = setup();
    await ctx.confirm();
    expect(ctx.commands).toHaveLength(0);
    await expect(ctx.service.assertRegisteredSealed(finalKey)).rejects.toThrow(
      'must be migrated',
    );
    await ctx.issue();
    ctx.upload();
    await expect(ctx.service.inspectSealed(finalKey)).rejects.toThrow(
      'must be migrated',
    );
  });

  it('does not issue a URL if persistence is uncertain or the destination is outside the animal', async () => {
    const ctx = setup();
    await expect(
      ctx.service.issue(ownerId, animalId, 'users/other/file', 'image/jpeg', 4),
    ).rejects.toThrow('Invalid animal upload');
    ctx.repository.create.mockRejectedValueOnce(
      new Error('Majority unavailable'),
    );
    await expect(ctx.issue()).rejects.toThrow('Majority unavailable');
    expect(ctx.signer).not.toHaveBeenCalled();
  });
});
