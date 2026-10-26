import { OwnershipArchiveS3Observer } from '../../../src/context/animal-transfer/application/ownership-archive-s3-observer';
import { s3ObservationFixture } from '../fixtures/ownership-archive-s3-observation.fixture';
import { advanceS3Observation } from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';

describe('Internal read-only S3 observer orchestration', () => {
  const setup = () => {
    const s = s3ObservationFixture();
    const repository = {
      startS3: jest.fn().mockResolvedValue(s.run),
      s3Page: jest
        .fn()
        .mockResolvedValue({ run: s.run, items: s.items, limit: 5 }),
      confirmS3: jest.fn().mockResolvedValue(s.run),
    };
    const storage = {
      observe: jest.fn((item: (typeof s.items)[0]) =>
        Promise.resolve({
          fileId: item.fileId,
          revision: { ...item.revision },
          sha256: item.intent.sha256,
        }),
      ),
    };
    return {
      ...s,
      repository,
      storage,
      service: new OwnershipArchiveS3Observer(repository, storage),
    };
  };
  it('acknowledges a DB work page, awaits bounded sequential reads then checkpoints exactly those receipts', async () => {
    const s = setup();
    await s.service.start(s.run.id);
    await s.service.observeBatch(s.run.id);
    expect(s.repository.startS3).toHaveBeenCalledWith(s.run.id);
    expect(s.repository.confirmS3).toHaveBeenCalledWith(
      { run: s.run, items: s.items, limit: 5 },
      s.receipts,
    );
    expect(s.repository.s3Page.mock.invocationCallOrder[0]).toBeLessThan(
      s.storage.observe.mock.invocationCallOrder[0],
    );
    expect(s.storage.observe.mock.invocationCallOrder[1]).toBeLessThan(
      s.repository.confirmS3.mock.invocationCallOrder[0],
    );
  });
  it('does not checkpoint a partial page or repair anything after a remote read fails', async () => {
    const s = setup();
    const error = new Error('stream interrupted');
    s.storage.observe
      .mockResolvedValueOnce(s.receipts[0])
      .mockRejectedValueOnce(error);
    await expect(s.service.observeBatch(s.run.id)).rejects.toBe(error);
    expect(s.repository.confirmS3).not.toHaveBeenCalled();
    expect(s.storage.observe).toHaveBeenCalledTimes(2);
    expect(s.service).not.toHaveProperty('materialize');
    expect(s.service).not.toHaveProperty('release');
  });
  it('does not read S3 if page acquisition is uncertain', async () => {
    const s = setup();
    s.repository.s3Page.mockRejectedValue(new Error('read reply lost'));
    await expect(s.service.observeBatch(s.run.id)).rejects.toThrow(
      'read reply lost',
    );
    expect(s.storage.observe).not.toHaveBeenCalled();
  });
  it('preserves a checkpoint error without resetting or claiming remote rollback', async () => {
    const s = setup();
    s.repository.confirmS3.mockRejectedValue(
      new Error('checkpoint reply lost'),
    );
    await expect(s.service.observeBatch(s.run.id)).rejects.toThrow(
      'checkpoint reply lost',
    );
    expect(s.repository.startS3).not.toHaveBeenCalled();
  });
  it('does not turn repeating a terminal record into a fresh S3 scan', async () => {
    const s = setup();
    s.run.s3Observation = advanceS3Observation(s.run, s.items, s.receipts, 5);
    s.repository.s3Page.mockResolvedValue({ run: s.run, items: [], limit: 5 });
    await s.service.observeBatch(s.run.id);
    expect(s.storage.observe).not.toHaveBeenCalled();
    expect(s.repository.confirmS3).not.toHaveBeenCalled();
  });
  it.each([0, -1, 21, 1.5, NaN])(
    'rejects invalid limit %s before repository',
    async (limit) => {
      const s = setup();
      await expect(s.service.observeBatch(s.run.id, limit)).rejects.toThrow();
      expect(s.repository.s3Page).not.toHaveBeenCalled();
    },
  );
  it('validates IDs and the entire page before the first GET', async () => {
    const s = setup();
    await expect(s.service.start('bad')).rejects.toThrow();
    await expect(s.service.observeBatch('bad')).rejects.toThrow();
    s.items[1].fileId = 'wrong';
    await expect(s.service.observeBatch(s.run.id)).rejects.toThrow();
    expect(s.storage.observe).not.toHaveBeenCalled();
  });
});
