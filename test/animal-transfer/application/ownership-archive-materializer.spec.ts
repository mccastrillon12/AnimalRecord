import { OwnershipArchiveMaterializer } from '../../../src/context/animal-transfer/application/ownership-archive-materializer';
import {
  OwnershipArchiveMaterializationRepository,
  OwnershipArchiveMaterializationStorage,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { materializationFixture } from '../fixtures/ownership-archive-materialization.fixture';

describe('Internal archive materializer orchestration', () => {
  const setup = () => {
    const fixture = materializationFixture();
    const revision = {
      etag: 'final',
      size: fixture.intent.source.size,
      versionId: 'final-v1',
    };
    const repository: jest.Mocked<OwnershipArchiveMaterializationRepository> = {
      start: jest.fn().mockResolvedValue(fixture.archive),
      claim: jest
        .fn()
        .mockResolvedValueOnce(fixture.intent)
        .mockResolvedValue(null),
      complete: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
      markComplete: jest.fn().mockResolvedValue(true),
    };
    const storage: jest.Mocked<OwnershipArchiveMaterializationStorage> = {
      materialize: jest.fn().mockResolvedValue(revision),
    };
    return {
      ...fixture,
      repository,
      storage,
      revision,
      service: new OwnershipArchiveMaterializer(repository, storage),
    };
  };
  it('persists a claim before S3 and confirms exactly the same intent/token before marking completion', async () => {
    const s = setup();
    await s.service.start(s.archive.id);
    await expect(s.service.copyBatch(s.archive.id)).resolves.toEqual({
      processed: 1,
      materialized: true,
    });
    const [, token, now, until] = s.repository.claim.mock.calls[0];
    expect(Date.parse(until) - Date.parse(now)).toBe(5 * 60 * 1000);
    expect(s.storage.materialize.mock.calls).toEqual([[s.intent]]);
    expect(s.repository.complete.mock.calls).toEqual([
      [s.intent, token, s.revision],
    ]);
    expect(s.repository.claim.mock.invocationCallOrder[0]).toBeLessThan(
      s.storage.materialize.mock.invocationCallOrder[0],
    );
    expect(s.repository.release.mock.calls).toHaveLength(0);
    expect(s.archive.state).toBe('READY');
  });
  it('bounds the batch and leaves other files for another invocation', async () => {
    const s = setup();
    await expect(s.service.copyBatch(s.archive.id, 1)).resolves.toMatchObject({
      processed: 1,
    });
    expect(s.repository.claim.mock.calls).toHaveLength(1);
  });
  it('preserves the original S3 failure even if releasing its lease also fails', async () => {
    const s = setup();
    const failure = new Error('remote result uncertain');
    s.storage.materialize.mockRejectedValue(failure);
    s.repository.release.mockRejectedValue(new Error('Mongo unavailable'));
    await expect(s.service.copyBatch(s.archive.id)).rejects.toBe(failure);
    expect(s.repository.complete.mock.calls).toHaveLength(0);
    expect(s.repository.markComplete.mock.calls).toHaveLength(0);
    expect(s.repository.release.mock.calls[0][0]).toBe(s.intent);
  });
  it('does not publish completion after losing the lease during a successful remote copy', async () => {
    const s = setup();
    s.repository.complete.mockResolvedValue(false);
    await expect(s.service.copyBatch(s.archive.id)).rejects.toThrow(
      'no longer owns this file lease',
    );
    expect(s.repository.markComplete.mock.calls).toHaveLength(0);
    expect(s.repository.release.mock.calls).toHaveLength(1);
  });
  it('does not execute S3 when acquiring has an uncertain result', async () => {
    const s = setup();
    s.repository.claim
      .mockReset()
      .mockRejectedValue(new Error('commit reply lost'));
    await expect(s.service.copyBatch(s.archive.id)).rejects.toThrow(
      'commit reply lost',
    );
    expect(s.storage.materialize.mock.calls).toHaveLength(0);
    expect(s.repository.release.mock.calls).toHaveLength(0);
  });
  it('resumes after a lost Mongo confirmation reply without repeating S3 or recreating a verified object', async () => {
    const s = setup();
    s.repository.complete.mockRejectedValueOnce(
      new Error('confirmation reply lost'),
    );
    await expect(s.service.copyBatch(s.archive.id)).rejects.toThrow(
      'confirmation reply lost',
    );
    // The repository observes no remaining claim on retry, as after a real committed confirmation.
    await expect(s.service.copyBatch(s.archive.id)).resolves.toEqual({
      processed: 0,
      materialized: true,
    });
    expect(s.storage.materialize.mock.calls).toHaveLength(1);
  });
  it.each([0, 21, 1.5, NaN])(
    'rejects invalid batch limit %s before acquiring',
    async (limit) => {
      const s = setup();
      await expect(s.service.copyBatch(s.archive.id, limit)).rejects.toThrow(
        'between 1 and 20',
      );
      expect(s.repository.claim.mock.calls).toHaveLength(0);
    },
  );
});
