import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { AwsOwnershipArchiveMaterializationStorage } from '../../../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-materialization-storage';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { materializationFixture } from '../fixtures/ownership-archive-materialization.fixture';
import {
  ARCHIVE_MATERIALIZATION_PROTOCOL,
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';

describe.each([
  ARCHIVE_MATERIALIZATION_PROTOCOL,
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
])(
  'AWS final materialization %s: no overwrite and explicit provenance',
  (protocol) => {
    let mock: jest.SpyInstance;
    afterEach(() => mock?.mockRestore());
    const setup = (versioned = true) => {
      const content = Buffer.from('animal-bytes');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const s = materializationFixture(sha256, versioned, protocol);
      type Stored = {
        bytes: Buffer;
        etag: string;
        versionId?: string;
        metadata: Record<string, string>;
        mime: string;
      };
      const objects = new Map<string, Stored>([
        [
          s.intent.sourceKey,
          {
            bytes: content,
            etag: s.intent.source.etag,
            versionId: s.intent.source.versionId,
            metadata: {},
            mime: 'application/pdf',
          },
        ],
      ]);
      const copies: CopyObjectCommand[] = [];
      const reads: GetObjectCommand[] = [];
      const state = {
        mode: 'normal' as
          | 'normal'
          | 'lost reply'
          | 'late'
          | 'corrupt'
          | 'competitor'
          | 'missing reply',
        pending: undefined as (() => void) | undefined,
        denyHead: false,
      };
      const identity = () => ({
        'ar-materialization-id': s.intent.definitionHash,
        'ar-archive-id': s.intent.archiveId,
        'ar-file-id': s.intent.fileId,
        'ar-sha256': sha256,
      });
      const send = jest.fn((command: unknown): Promise<unknown> => {
        if (command instanceof HeadObjectCommand) {
          if (state.denyHead)
            throw Object.assign(new Error('forbidden'), {
              $metadata: { httpStatusCode: 403 },
            });
          const object = objects.get(command.input.Key!);
          if (!object)
            throw Object.assign(new Error('not found'), {
              $metadata: { httpStatusCode: 404 },
            });
          if (
            command.input.IfMatch &&
            (command.input.IfMatch !== object.etag ||
              command.input.VersionId !== object.versionId)
          )
            throw new Error('PreconditionFailed');
          return Promise.resolve({
            ETag: object.etag,
            VersionId: object.versionId,
            ContentLength: object.bytes.length,
            ContentType: object.mime,
            ContentDisposition: 'inline',
            Metadata: object.metadata,
          });
        }
        if (command instanceof GetObjectCommand) {
          reads.push(command);
          const object = objects.get(command.input.Key!)!;
          if (
            command.input.IfMatch !== object.etag ||
            command.input.VersionId !== object.versionId
          )
            throw new Error('PreconditionFailed');
          return Promise.resolve({
            Body: Readable.from([
              object.bytes.subarray(0, 4),
              object.bytes.subarray(4),
            ]),
          });
        }
        if (command instanceof CopyObjectCommand) {
          copies.push(command);
          const copy = () => {
            if (objects.has(command.input.Key!))
              throw Object.assign(new Error('exists'), {
                $metadata: { httpStatusCode: 412 },
              });
            const sourceKey = decodeURIComponent(
              command.input
                .CopySource!.split('?')[0]
                .slice('test-bucket/'.length),
            );
            const source = objects.get(sourceKey)!;
            if (source.etag !== command.input.CopySourceIfMatch)
              throw new Error('PreconditionFailed');
            const bytes = Buffer.from(source.bytes);
            if (state.mode === 'corrupt') bytes[0] ^= 1;
            objects.set(command.input.Key!, {
              bytes,
              etag: 'final-etag',
              versionId: versioned ? 'final-v1' : undefined,
              metadata: command.input.Metadata!,
              mime: command.input.ContentType!,
            });
          };
          if (state.mode === 'competitor') {
            objects.set(s.intent.destinationKey, {
              bytes: content,
              etag: 'competitor',
              metadata: {},
              mime: 'application/pdf',
            });
            copy();
          }
          if (state.mode === 'late') {
            state.pending = copy;
            throw new Error('timeout before remote completion');
          }
          if (state.mode === 'missing reply')
            throw new Error('timeout without known result');
          copy();
          if (state.mode === 'lost reply')
            throw new Error('response lost after copy');
          return Promise.resolve({
            CopyObjectResult: { ETag: 'final-etag' },
            VersionId: versioned ? 'final-v1' : undefined,
          });
        }
        throw new Error('unexpected command');
      });
      mock = jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation(send as never);
      const storage = new AwsOwnershipArchiveMaterializationStorage({
        getAwsS3BucketName: () => 'test-bucket',
        getAwsS3Region: () => 'us-east-1',
      } as EnvironmentConfigService);
      return {
        ...s,
        content,
        objects,
        copies,
        reads,
        state,
        identity,
        storage,
      };
    };
    it.each([true, false])(
      'copies only into an empty destination and pins source/digest (versioned=%s)',
      async (versioned) => {
        const s = setup(versioned);
        const result = await s.storage.materialize(s.intent);
        expect(result).toEqual({
          etag: 'final-etag',
          size: 12,
          versionId: versioned ? 'final-v1' : undefined,
        });
        expect(s.copies[0].input.IfNoneMatch).toBe('*');
        expect(s.copies[0].input.CopySourceIfMatch).toBe('staging');
        expect(s.copies[0].input.CopySource!.includes('?versionId=')).toBe(
          versioned,
        );
        expect(s.copies[0].input.Metadata).toEqual(s.identity());
        expect(s.copies[0].input.ContentType).toBe('application/pdf');
        expect(s.copies[0].input.ContentDisposition).toBe('inline');
        expect(s.copies[0].input.TaggingDirective).toBe('REPLACE');
        expect(s.copies[0].input.Tagging).toBe('');
        expect(s.objects.get(s.intent.sourceKey)!.bytes).toEqual(s.content);
        await s.storage.materialize(s.intent);
        expect(s.copies).toHaveLength(1);
      },
    );
    it('reconciles a lost copy reply by verifying the final identity and actual bytes', async () => {
      const s = setup();
      s.state.mode = 'lost reply';
      await expect(s.storage.materialize(s.intent)).resolves.toMatchObject({
        etag: 'final-etag',
      });
      expect(s.copies).toHaveLength(1);
    });
    it('reconciles concurrent conditional copies of the same durable intent', async () => {
      const s = setup();
      const results = await Promise.all([
        s.storage.materialize(s.intent),
        s.storage.materialize(s.intent),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(s.copies.every((copy) => copy.input.IfNoneMatch === '*')).toBe(
        true,
      );
      expect(s.objects.get(s.intent.destinationKey)!.bytes).toEqual(s.content);
    });
    it('rejects provenance from another preparation even with identical bytes and matching archive/file', async () => {
      const s = setup();
      s.objects.set(s.intent.destinationKey, {
        bytes: s.content,
        etag: 'earlier',
        metadata: {
          ...s.identity(),
          'ar-materialization-id': 'another-intent',
        },
        mime: 'application/pdf',
      });
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'conflicting content or provenance',
      );
      expect(s.copies).toHaveLength(0);
    });
    it('retries after a late remote completion without rewriting it', async () => {
      const s = setup();
      s.state.mode = 'late';
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'retry the same preparation',
      );
      s.state.pending!();
      await expect(s.storage.materialize(s.intent)).resolves.toMatchObject({
        etag: 'final-etag',
      });
      expect(s.copies).toHaveLength(1);
    });
    if (protocol === ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL) {
      it.each(['normal', 'lost reply', 'late'] as const)(
        'materializes beside an occupied original destination (%s) and preserves it',
        async (mode) => {
          const s = setup();
          const previous = {
            bytes: s.content,
            etag: 'previous-period',
            metadata: {},
            mime: 'application/pdf',
          };
          s.objects.set(s.file.recipientFinalKey, previous);
          s.state.mode = mode;
          if (mode === 'late') {
            await expect(s.storage.materialize(s.intent)).rejects.toThrow(
              'retry the same preparation',
            );
            s.state.pending!();
          }
          await expect(s.storage.materialize(s.intent)).resolves.toMatchObject({
            etag: 'final-etag',
          });
          expect(s.objects.get(s.file.recipientFinalKey)).toBe(previous);
          expect(s.objects.get(s.intent.destinationKey)!.bytes).toEqual(
            s.content,
          );
          expect(s.copies).toHaveLength(1);
          expect(s.copies[0].input.Key).toBe(s.intent.destinationKey);
          expect(s.copies[0].input.IfNoneMatch).toBe('*');
          expect(
            s.reads.every(
              (read) => read.input.Key !== s.file.recipientFinalKey,
            ),
          ).toBe(true);
        },
      );
    }
    it('preserves a previous owner/return object even when its bytes are identical', async () => {
      const s = setup();
      s.objects.set(s.intent.destinationKey, {
        bytes: s.content,
        etag: 'previous-owner',
        metadata: {},
        mime: 'application/pdf',
      });
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'conflicting content or provenance',
      );
      expect(s.copies).toHaveLength(0);
      expect(s.objects.get(s.intent.destinationKey)!.etag).toBe(
        'previous-owner',
      );
    });
    it('does not overwrite a competing object created between HEAD and CopyObject', async () => {
      const s = setup();
      s.state.mode = 'competitor';
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'conflicting content or provenance',
      );
      expect(s.objects.get(s.intent.destinationKey)!.etag).toBe('competitor');
      expect(s.copies).toHaveLength(1);
    });
    it('rejects same-size corruption and never repairs an existing own object by overwriting it', async () => {
      const s = setup();
      s.state.mode = 'corrupt';
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'final integrity',
      );
      await expect(s.storage.materialize(s.intent)).rejects.toThrow(
        'final integrity',
      );
      expect(s.copies).toHaveLength(1);
    });
    it.each([
      'source changed',
      'source missing',
      'staging corrupt',
      'head forbidden',
      'missing MIME',
    ])('does not copy on %s', async (problem) => {
      const s = setup();
      if (problem === 'source changed')
        s.objects.get(s.intent.sourceKey)!.etag = 'changed';
      if (problem === 'source missing') s.objects.delete(s.intent.sourceKey);
      if (problem === 'staging corrupt')
        s.objects.get(s.intent.sourceKey)!.bytes[0] ^= 1;
      if (problem === 'head forbidden') s.state.denyHead = true;
      if (problem === 'missing MIME')
        s.objects.get(s.intent.sourceKey)!.mime = '';
      await expect(s.storage.materialize(s.intent)).rejects.toThrow();
      expect(s.copies).toHaveLength(0);
    });
  },
);
