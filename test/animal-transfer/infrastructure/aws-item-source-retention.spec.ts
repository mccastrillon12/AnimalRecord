import {
  HeadObjectCommand,
  PutObjectRetentionCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { AwsItemSourceRetention } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-source-retention';

const configuration = {
  bucket: 'synthetic-media',
  expectedBucketOwner: '123456789012',
  retainUntil: '2090-01-02T00:00:00.000Z',
};
const now = '2090-01-01T00:00:00.000Z';
const horizon = '2090-01-01T12:00:00.000Z';
const source = {
  key: 'users/test/animals/test/medical-documents/example.pdf',
  revision: { versionId: 'source-version', etag: '"source-etag"', size: 12 },
};
const head = {
  $metadata: { httpStatusCode: 200 },
  VersionId: source.revision.versionId,
  ETag: source.revision.etag,
  ContentLength: source.revision.size,
};
const protectedVersion = {
  ...head,
  ObjectLockMode: 'COMPLIANCE',
  ObjectLockRetainUntilDate: new Date(configuration.retainUntil),
};

function fixture() {
  const send = jest.fn();
  const storage = new AwsItemSourceRetention(
    { send } as unknown as Pick<S3Client, 'send'>,
    configuration,
    () => new Date(now),
  );
  return { send, storage };
}

it('confirms the exact retained source after an ambiguous response, and skips rewriting on replay', async () => {
  const { send, storage } = fixture();
  send
    .mockResolvedValueOnce(head)
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValue(protectedVersion);
  await storage.retainSource(source, horizon);
  await storage.retainSource(source, horizon);
  const [[first], [put], [confirmation], [replay]] = send.mock.calls as [
    [HeadObjectCommand],
    [PutObjectRetentionCommand],
    [HeadObjectCommand],
    [HeadObjectCommand],
  ];
  expect(send).toHaveBeenCalledTimes(4);
  expect(first).toBeInstanceOf(HeadObjectCommand);
  expect(put).toBeInstanceOf(PutObjectRetentionCommand);
  expect(put.input).toEqual({
    Bucket: configuration.bucket,
    Key: source.key,
    ExpectedBucketOwner: configuration.expectedBucketOwner,
    VersionId: source.revision.versionId,
    ChecksumAlgorithm: 'SHA256',
    Retention: {
      Mode: 'COMPLIANCE',
      RetainUntilDate: new Date(configuration.retainUntil),
    },
  });
  expect(confirmation.input).toEqual(first.input);
  expect(replay.input).toEqual(first.input);
});

it.each(['null', undefined])(
  'leaves legacy version %s to the explicit preparation flow',
  async (versionId) => {
    const { send, storage } = fixture();
    await expect(
      storage.retainSource(
        { ...source, revision: { ...source.revision, versionId } },
        horizon,
      ),
    ).rejects.toThrow('explicit object version');
    expect(send).not.toHaveBeenCalled();
  },
);

it.each([
  { ...head, ETag: '"another-etag"' },
  { ...protectedVersion, ObjectLockMode: 'GOVERNANCE' },
])(
  'rejects incompatible source observations before mutation',
  async (unexpected) => {
    const { send, storage } = fixture();
    send.mockResolvedValueOnce(unexpected);
    await expect(storage.retainSource(source, horizon)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('requires independent readback even when the PUT returns success', async () => {
  const { send, storage } = fixture();
  send.mockResolvedValue(head);
  await expect(storage.retainSource(source, horizon)).rejects.toThrow(
    'did not confirm retention',
  );
  expect(send).toHaveBeenCalledTimes(3);
});
