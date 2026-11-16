import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import type { LaterPeriodLivePutEffect } from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsLaterPeriodLivePutAuditReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-later-period-live-put-audit-reader';

const marker = 'a'.repeat(64);
const effect: LaterPeriodLivePutEffect = {
  target: {
    bucket: 'synthetic-history',
    key: 'users/synthetic/photo.jpg',
    expectedBucketOwner: '123456789012',
  },
  authorizationId: archiveHash('permission ID'),
  permissionHash: archiveHash('permission'),
  attemptDefinitionHash: archiveHash('attempt'),
  transportRequestHash: archiveHash('transport'),
  auditMarkerHash: archiveHash(marker),
  sha256: archiveHash('bytes'),
  size: 24,
  admittedAt: '2026-10-29T12:03:00.000Z',
};
const notification = {
  event: 'ObjectCreated:Put' as const,
  target: effect.target,
  requestId: 'S3-123',
  occurredAt: '2026-10-29T12:03:01.000Z',
  revision: { versionId: 'version-put', etag: '"stored-etag"', size: 24 },
};

function setup() {
  const { revision } = notification;
  const readCreatedPuts = jest.fn().mockResolvedValue([notification]);
  const head = {
    $metadata: { httpStatusCode: 200 },
    VersionId: revision.versionId,
    ETag: revision.etag,
    ContentLength: revision.size,
    Metadata: { [ITEM_PUT_AUDIT_METADATA]: marker },
  };
  const send = jest.fn<Promise<HeadObjectCommandOutput>, [HeadObjectCommand]>();
  send.mockResolvedValue(head);
  const reader = new AwsLaterPeriodLivePutAuditReader({ readCreatedPuts }, {
    send,
  } as unknown as Pick<S3Client, 'send'>);
  return { reader, head, send, readCreatedPuts };
}

describe('Independent S3 live PUT audit', () => {
  it('keeps a legacy permit unknown with zero lookups', async () => {
    const f = setup();
    await expect(
      f.reader.readAppliedVersion({ ...effect, auditMarkerHash: undefined }),
    ).resolves.toBeNull();
    expect(f.readCreatedPuts).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('cannot use object metadata without an independent PUT notification', async () => {
    const f = setup();
    f.readCreatedPuts.mockResolvedValue([]);
    await expect(f.reader.readAppliedVersion(effect)).resolves.toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('requires the marker even for a matching destination, size and version', async () => {
    const f = setup();
    f.send.mockResolvedValue({ ...f.head, Metadata: {} });
    await expect(f.reader.readAppliedVersion(effect)).resolves.toBeNull();
    f.send.mockResolvedValue({
      ...f.head,
      Metadata: { [ITEM_PUT_AUDIT_METADATA]: 'b'.repeat(64) },
    });
    await expect(f.reader.readAppliedVersion(effect)).resolves.toBeNull();
  });

  it('rejects a HEAD response for a different version with the right marker', async () => {
    const f = setup();
    f.send.mockResolvedValue({ ...f.head, VersionId: 'version-other' });
    await expect(f.reader.readAppliedVersion(effect)).rejects.toThrow(
      'do not identify one permitted PUT',
    );
  });

  it('skips a PUT before the permitted send', async () => {
    const f = setup();
    f.readCreatedPuts.mockResolvedValue([
      { ...notification, occurredAt: '2026-10-29T12:02:59.000Z' },
    ]);
    await expect(f.reader.readAppliedVersion(effect)).resolves.toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a notification outside the pinned target', async () => {
    const f = setup();
    f.readCreatedPuts.mockResolvedValue([
      { ...notification, target: { ...effect.target, key: 'other.jpg' } },
    ]);
    await expect(f.reader.readAppliedVersion(effect)).rejects.toThrow(
      'do not identify one permitted PUT',
    );
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects conflicting facts for the same notification identity', async () => {
    const f = setup();
    f.readCreatedPuts.mockResolvedValue([
      notification,
      {
        ...notification,
        revision: { ...notification.revision, size: effect.size + 1 },
      },
    ]);
    await expect(f.reader.readAppliedVersion(effect)).rejects.toThrow(
      'do not identify one permitted PUT',
    );
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects two distinct requests that match the same permit marker', async () => {
    const f = setup();
    const otherVersion = 'version-other';
    f.readCreatedPuts.mockResolvedValue([
      notification,
      {
        ...notification,
        requestId: 'S3-456',
        revision: { ...notification.revision, versionId: otherVersion },
      },
    ]);
    f.send.mockResolvedValueOnce(f.head).mockResolvedValueOnce({
      ...f.head,
      VersionId: otherVersion,
    });
    await expect(f.reader.readAppliedVersion(effect)).rejects.toThrow(
      'do not identify one permitted PUT',
    );
  });
});
