import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { AwsOwnershipArchiveStorage } from '../../../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-storage';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import { ArchiveFile } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { AwsS3StorageService } from '../../../src/context/shared/infrastructure/storage/aws-s3-storage.service';

describe('AWS archive copy integrity', () => {
  const sourceKey = 'users/owner/animals/animal/diary/entry/audio file.mp3';
  const historicalKey =
    'users/owner/animals/animal/ownership-archives/archive/diary/entry/audio file.mp3';
  const recipientStagingKey =
    'users/recipient/animals/animal/transfer-preparations/archive/diary/entry/audio file.mp3';
  const content = Buffer.from('original animal audio');
  let mock: jest.SpyInstance;

  afterEach(() => mock?.mockRestore());

  const setup = (corruptRecipient = false) => {
    const objects = new Map<
      string,
      { content: Buffer; etag: string; versionId: string }
    >([
      [sourceKey, { content, etag: 'original-etag', versionId: 'source-v/1' }],
    ]);
    const copies: CopyObjectCommand[] = [];
    const reads: GetObjectCommand[] = [];
    const send = jest.fn((command: unknown): Promise<unknown> => {
      if (command instanceof HeadObjectCommand) {
        const object = objects.get(command.input.Key!)!;
        return Promise.resolve({
          ETag: object.etag,
          ContentLength: object.content.length,
          VersionId: object.versionId,
        });
      }
      if (command instanceof GetObjectCommand) {
        reads.push(command);
        const object = objects.get(command.input.Key!)!;
        if (
          object.etag !== command.input.IfMatch ||
          object.versionId !== command.input.VersionId
        )
          throw new Error('PreconditionFailed');
        return Promise.resolve({
          Body: Readable.from([
            object.content.subarray(0, 3),
            object.content.subarray(3),
          ]),
        });
      }
      if (command instanceof CopyObjectCommand) {
        copies.push(command);
        const source = decodeURIComponent(
          command.input.CopySource!.split('?')[0].slice('test-bucket/'.length),
        );
        const object = objects.get(source)!;
        if (object.etag !== command.input.CopySourceIfMatch)
          throw new Error('PreconditionFailed');
        const key = command.input.Key!;
        const bytes = Buffer.from(object.content);
        if (corruptRecipient && key === recipientStagingKey) bytes[0] ^= 1;
        const etag = `copy-${copies.length}`;
        const versionId = `version-${copies.length}`;
        objects.set(key, { content: bytes, etag, versionId });
        return Promise.resolve({
          CopyObjectResult: { ETag: etag },
          VersionId: versionId,
        });
      }
      throw new Error('Unexpected S3 operation');
    });
    mock = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(send as never);
    const storage = new AwsOwnershipArchiveStorage(
      {
        getAwsS3BucketName: () => 'test-bucket',
        getAwsS3Region: () => 'us-east-1',
      } as EnvironmentConfigService,
      { getFileKey: () => undefined } as unknown as AwsS3StorageService,
      {
        assertRegisteredSealed: () => Promise.resolve(),
        inspectSealed: () =>
          Promise.resolve({
            etag: 'original-etag',
            size: content.length,
            versionId: 'source-v/1',
          }),
      } as unknown as AnimalMediaUploads,
    );
    const file: ArchiveFile = {
      id: 'file',
      archiveId: 'archive',
      sourceKey,
      historicalKey,
      recipientStagingKey,
      relativeKey: 'diary/entry/audio file.mp3',
      recipientFinalKey:
        'users/recipient/animals/animal/diary/entry/audio file.mp3',
      source: {
        etag: 'original-etag',
        versionId: 'source-v/1',
        size: content.length,
      },
      definitionHash: 'definition-hash',
      state: 'PENDING',
    };
    return { storage, file, copies, reads, objects };
  };

  it('pins source revision and verifies both independent copies by streaming SHA-256', async () => {
    const { storage, file, copies, reads, objects } = setup();
    const result = await storage.copyAndVerify(file);
    expect(result.sha256).toBe(
      createHash('sha256').update(content).digest('hex'),
    );
    expect(copies).toHaveLength(2);
    expect(copies[0].input.CopySource).toContain(
      'audio%20file.mp3?versionId=source-v%2F1',
    );
    expect(copies[0].input.CopySourceIfMatch).toBe(file.source.etag);
    expect(reads[0].input.VersionId).toBe('source-v/1');
    expect(reads[0].input.IfMatch).toBe('original-etag');
    expect(objects.get(sourceKey)!.content).toEqual(content);
    expect(objects.has(file.recipientFinalKey)).toBe(false);
    expect(result.historical.versionId).toBe('version-1');
    expect(result.recipientStaging.versionId).toBe('version-2');
  });

  it('detects same-size corruption instead of assuming that size or ETag is a content hash', async () => {
    const { storage, file } = setup(true);
    await expect(storage.copyAndVerify(file)).rejects.toThrow(
      'Recipient copy integrity',
    );
  });

  it('stops if the source changed after its revision was recorded', async () => {
    const { storage, file, objects, copies } = setup();
    objects.get(sourceKey)!.etag = 'changed-etag';
    await expect(storage.copyAndVerify(file)).rejects.toThrow(
      'PreconditionFailed',
    );
    expect(copies).toHaveLength(0);
  });

  it('uses the registered sealed media revision during manifest construction', async () => {
    const { storage, reads } = setup();
    await expect(storage.inspect(sourceKey)).resolves.toEqual({
      etag: 'original-etag',
      size: content.length,
      versionId: 'source-v/1',
    });
    expect(reads).toHaveLength(0);
  });

  it('copies only the pinned historical source and compares against its previous digest', async () => {
    const { storage, file, objects, copies, reads } = setup();
    const retainedKey =
      'users/previous/animals/animal/ownership-archives/previous/diary/audio.mp3';
    objects.set(retainedKey, objects.get(sourceKey)!);
    objects.delete(sourceKey); // Active original was deleted after the old cut.
    file.sourceKey = retainedKey;
    file.retained = {
      rootArchiveId: 'previous',
      rootFileId: 'old-file',
      relativeKey: 'diary/audio.mp3',
      sourceArchiveId: 'previous',
      sourceFileId: 'old-file',
      sourceDefinitionHash: 'old-definition',
      sha256: createHash('sha256').update(content).digest('hex'),
    };
    await expect(storage.copyAndVerify(file)).resolves.toMatchObject({
      sha256: file.retained.sha256,
    });
    expect(reads[0].input.Key).toBe(retainedKey);
    expect(copies[0].input.CopySource).toContain(
      'ownership-archives/previous/diary/audio.mp3',
    );
    expect(objects.has(file.recipientFinalKey)).toBe(false);
  });

  it('rejects a retained digest mismatch before creating any new copy', async () => {
    const { storage, file, copies } = setup();
    file.retained = {
      rootArchiveId: 'previous',
      rootFileId: 'old-file',
      relativeKey: 'diary/audio.mp3',
      sourceArchiveId: 'previous',
      sourceFileId: 'old-file',
      sourceDefinitionHash: 'old-definition',
      sha256: '0'.repeat(64),
    };
    await expect(storage.copyAndVerify(file)).rejects.toThrow(
      'Retained source integrity',
    );
    expect(copies).toHaveLength(0);
  });
});
