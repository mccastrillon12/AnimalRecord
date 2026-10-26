import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { AwsOwnershipArchiveS3ObservationStorage } from '../../../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-s3-observation-storage';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { s3ObservationFixture } from '../fixtures/ownership-archive-s3-observation.fixture';

describe('Read-only AWS final-object observation', () => {
  let mock: jest.SpyInstance;
  afterEach(() => mock?.mockRestore());
  const setup = (versioned = true) => {
    const content = Buffer.from('animal-bytes');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const item = s3ObservationFixture().items[0];
    const { definitionHash: oldHash, ...definition } = item.intent;
    expect(oldHash).toHaveLength(64);
    item.intent = {
      ...definition,
      sha256,
      definitionHash: archiveHash({ ...definition, sha256 }),
    };
    if (!versioned) delete item.revision.versionId;
    const metadata = {
      'ar-materialization-id': item.intent.definitionHash,
      'ar-archive-id': item.intent.archiveId,
      'ar-file-id': item.fileId,
      'ar-sha256': sha256,
    };
    const state = {
      exists: true,
      denyHead: false,
      denyGet: false,
      corrupt: false,
      missingBody: false,
      streamError: false,
      wrongGetVersion: false,
      mutateDuringRead: false,
      deleteDuringRead: false,
      mutateAfterLastHead: false,
      etag: item.revision.etag,
      versionId: item.revision.versionId,
      metadata,
      headCount: 0,
    };
    const commands: Array<HeadObjectCommand | GetObjectCommand> = [];
    const headers = () => ({
      ETag: state.etag,
      VersionId: state.versionId,
      ContentLength: 12,
      Metadata: { ...state.metadata },
    });
    const send = jest.fn((command: unknown): Promise<unknown> => {
      if (command instanceof HeadObjectCommand) {
        commands.push(command);
        state.headCount++;
        if (state.denyHead)
          throw Object.assign(new Error('denied'), {
            $metadata: { httpStatusCode: 403 },
          });
        if (!state.exists)
          throw Object.assign(new Error('not found'), {
            $metadata: { httpStatusCode: 404 },
          });
        const result = headers();
        if (state.mutateAfterLastHead && state.headCount === 2)
          state.etag = 'changed after observation';
        return Promise.resolve(result);
      }
      if (command instanceof GetObjectCommand) {
        commands.push(command);
        if (state.denyGet) throw new Error('precondition or read denied');
        expect(command.input.IfMatch).toBe(item.revision.etag);
        expect(command.input.VersionId).toBe(item.revision.versionId);
        const bytes = Buffer.from(content);
        if (state.corrupt) bytes[0] ^= 1;
        const result = headers();
        if (state.wrongGetVersion) result.VersionId = 'wrong-get-version';
        if (state.mutateDuringRead) {
          state.etag = 'new-etag';
          state.versionId = 'new-version';
        }
        if (state.deleteDuringRead) state.exists = false;
        const body = state.streamError
          ? Readable.from(
              (function* () {
                yield bytes.subarray(0, 4);
                throw new Error('remote stream failure');
              })(),
            )
          : Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]);
        return Promise.resolve({
          ...result,
          Body: state.missingBody ? undefined : body,
        });
      }
      throw new Error(
        'A read-only observer must never issue any other S3 operation',
      );
    });
    mock = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(send as never);
    const storage = new AwsOwnershipArchiveS3ObservationStorage({
      getAwsS3BucketName: () => 'test-bucket',
      getAwsS3Region: () => 'us-east-1',
    } as EnvironmentConfigService);
    return { item, content, sha256, state, commands, storage };
  };
  it.each([true, false])(
    'observes only the recorded final via HEAD/GET/HEAD (versioned=%s)',
    async (versioned) => {
      const s = setup(versioned);
      await expect(s.storage.observe(s.item)).resolves.toEqual({
        fileId: s.item.fileId,
        revision: s.item.revision,
        sha256: s.sha256,
      });
      expect(s.commands.map((command) => command.constructor.name)).toEqual([
        'HeadObjectCommand',
        'GetObjectCommand',
        'HeadObjectCommand',
      ]);
      for (const command of s.commands) {
        expect(command.input.Key).toBe(s.item.intent.destinationKey);
        if (command instanceof HeadObjectCommand)
          expect(command.input).not.toHaveProperty('VersionId');
      }
      expect(s.storage).not.toHaveProperty('materialize');
    },
  );
  it.each([
    'absent',
    'forbidden head',
    'read failed',
    'wrong current revision',
    'wrong current version',
    'foreign same-bytes identity',
    'corrupt bytes',
    'missing body',
    'stream error',
    'wrong GET version',
    'changed during read',
    'deleted during read',
  ])('does not accept, repair or refix %s', async (problem) => {
    const s = setup();
    if (problem === 'absent') s.state.exists = false;
    if (problem === 'forbidden head') s.state.denyHead = true;
    if (problem === 'read failed') s.state.denyGet = true;
    if (problem === 'wrong current revision') s.state.etag = 'other';
    if (problem === 'wrong current version') s.state.versionId = 'other';
    if (problem === 'foreign same-bytes identity')
      s.state.metadata['ar-materialization-id'] = 'foreign';
    if (problem === 'corrupt bytes') s.state.corrupt = true;
    if (problem === 'missing body') s.state.missingBody = true;
    if (problem === 'stream error') s.state.streamError = true;
    if (problem === 'wrong GET version') s.state.wrongGetVersion = true;
    if (problem === 'changed during read') s.state.mutateDuringRead = true;
    if (problem === 'deleted during read') s.state.deleteDuringRead = true;
    const before = archiveHash(s.item);
    await expect(s.storage.observe(s.item)).rejects.toThrow();
    expect(archiveHash(s.item)).toBe(before);
    expect(
      s.commands.every(
        (command) =>
          command instanceof HeadObjectCommand ||
          command instanceof GetObjectCommand,
      ),
    ).toBe(true);
    expect(
      s.commands.every(
        (command) => command.input.Key === s.item.intent.destinationKey,
      ),
    ).toBe(true);
  });
  it('a repeat after an absent read can observe the SAME late-created final without copying it', async () => {
    const s = setup();
    s.state.exists = false;
    await expect(s.storage.observe(s.item)).rejects.toThrow('unavailable');
    s.state.exists = true;
    await expect(s.storage.observe(s.item)).resolves.toMatchObject({
      sha256: s.sha256,
    });
    expect(s.commands).toHaveLength(4);
  });
  it('does not pretend the final HEAD prevents mutations after its response', async () => {
    const s = setup();
    s.state.mutateAfterLastHead = true;
    await expect(s.storage.observe(s.item)).resolves.toMatchObject({
      sha256: s.sha256,
    });
    expect(s.state.etag).not.toBe(s.item.revision.etag);
    // Observation is evidence of completed reads, not a lock or a permission to publish.
    await expect(s.storage.observe(s.item)).rejects.toThrow('differs');
  });
});
