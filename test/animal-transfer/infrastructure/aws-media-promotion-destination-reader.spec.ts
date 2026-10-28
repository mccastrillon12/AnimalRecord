import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { AwsMediaPromotionDestinationReader } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader';
import { promotionFixture } from '../fixtures/media-promotion.fixture';

const definition = () =>
  structuredClone(promotionFixture().declared.effects[0].definition);
const revision = { etag: '"final"', size: 32, versionId: 'version/2' };
function setup() {
  const send = jest.fn<
      Promise<unknown>,
      [HeadObjectCommand | GetObjectCommand]
    >(),
    reader = new AwsMediaPromotionDestinationReader({ send } as unknown as Pick<
      S3Client,
      'send'
    >);
  return { send, reader };
}
describe('Read-only promotion S3 adapter with fake SDK client, no sockets', () => {
  it('binds HEAD only to the final bucket/key and allowlists response evidence', async () => {
    const f = setup(),
      d = definition();
    f.send.mockResolvedValue({
      ETag: revision.etag,
      ContentLength: 32,
      VersionId: revision.versionId,
      ContentType: d.mimeType,
      Metadata: {
        'animal-upload-id': d.uploadId,
        'animal-upload-sha256': d.source.sha256,
        secret: 'ignored',
      },
      Private: 'ignored',
    });
    const pending = f.reader.head(d);
    d.bucket = 'changed';
    d.destinationKey = 'changed';
    expect(await pending).toEqual({
      ...revision,
      bucket: definition().bucket,
      key: definition().destinationKey,
      mimeType: definition().mimeType,
      uploadId: definition().uploadId,
      sha256: definition().source.sha256,
    });
    expect(f.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect((f.send.mock.calls[0][0] as HeadObjectCommand).input).toEqual({
      Bucket: definition().bucket,
      Key: definition().destinationKey,
    });
  });
  it.each([undefined, 'version/2'])(
    'fixes GET to observed ETag/version %s, returns headers and closes Node body',
    async (versionId) => {
      const f = setup(),
        body = Readable.from([Buffer.alloc(32)]),
        d = definition(),
        fixed = { ...revision, versionId };
      f.send.mockResolvedValue({
        Body: body,
        ETag: fixed.etag,
        ContentLength: fixed.size,
        VersionId: versionId,
      });
      const pending = f.reader.read(d, fixed);
      fixed.etag = 'changed';
      d.destinationKey = 'changed';
      const read = await pending;
      expect(f.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
      expect((f.send.mock.calls[0][0] as GetObjectCommand).input).toEqual({
        Bucket: definition().bucket,
        Key: definition().destinationKey,
        IfMatch: revision.etag,
        VersionId: versionId,
      });
      expect(read.revision).toEqual({ ...revision, versionId });
      read.close();
      expect(body.destroyed).toBe(true);
    },
  );
  it('maps only a definitive HEAD 404 to absent', async () => {
    const f = setup();
    f.send.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    expect(await f.reader.head(definition())).toBeNull();
  });
  it.each([403, 412, 500, undefined])(
    'does not invent absence from HEAD failure %s or leak the SDK error',
    async (status) => {
      const f = setup();
      f.send.mockRejectedValue(
        Object.assign(new Error('secret'), {
          $metadata: { httpStatusCode: status },
        }),
      );
      await expect(f.reader.head(definition())).rejects.toMatchObject({
        message: 'S3 could not inspect the promotion destination',
      });
    },
  );
  it.each([404, 412])(
    'maps a GET %s to conflict without retrying',
    async (status) => {
      const f = setup();
      f.send.mockRejectedValue({ $metadata: { httpStatusCode: status } });
      await expect(f.reader.read(definition(), revision)).rejects.toThrow(
        'changed during verification',
      );
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([403, 500, undefined])(
    'sanitizes GET %s as an external failure',
    async (status) => {
      const f = setup();
      f.send.mockRejectedValue(
        Object.assign(new Error('secret'), {
          $metadata: { httpStatusCode: status },
        }),
      );
      await expect(f.reader.read(definition(), revision)).rejects.toThrow(
        'S3 could not read the promotion destination',
      );
    },
  );
  it.each([undefined, Buffer.from('raw'), { transformToString: () => 'raw' }])(
    'rejects a non-Node SDK body without buffering %j',
    async (Body) => {
      const f = setup();
      f.send.mockResolvedValue({
        Body,
        ETag: revision.etag,
        ContentLength: 32,
      });
      await expect(f.reader.read(definition(), revision)).rejects.toThrow(
        'changed during verification',
      );
    },
  );
});
