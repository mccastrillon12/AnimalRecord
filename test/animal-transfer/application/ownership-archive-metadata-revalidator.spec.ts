import { OwnershipArchiveMetadataRevalidator } from '../../../src/context/animal-transfer/application/ownership-archive-metadata-revalidator';
import { historyUuid } from '../fixtures/ownership-archive-history.fixture';

describe('Internal metadata revalidation orchestration', () => {
  const setup = () => {
    const repository = {
      start: jest.fn().mockResolvedValue({ phase: 'ENTRIES' }),
      nextPage: jest.fn().mockResolvedValue({ phase: 'METADATA_OBSERVED' }),
    };
    return {
      repository,
      service: new OwnershipArchiveMetadataRevalidator(repository),
    };
  };
  it('requires explicit identities, delegates bounded pages and offers no activation/commit', async () => {
    const s = setup();
    const id = historyUuid(800),
      archiveId = historyUuid(101);
    await expect(s.service.start(id, archiveId)).resolves.toEqual({
      phase: 'ENTRIES',
    });
    await s.service.nextPage(id);
    expect(s.repository.start).toHaveBeenCalledWith(id, archiveId);
    expect(s.repository.nextPage).toHaveBeenCalledWith(id, 20);
    expect(s.service).not.toHaveProperty('commit');
    expect(s.service).not.toHaveProperty('activate');
  });
  it.each([0, -1, 101, 1.5, NaN])(
    'rejects page size %s before persistence',
    async (limit) => {
      const s = setup();
      await expect(
        s.service.nextPage(historyUuid(800), limit),
      ).rejects.toThrow();
      expect(s.repository.nextPage).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid run/archive IDs before persistence', async () => {
    const s = setup();
    await expect(s.service.start('bad', historyUuid(101))).rejects.toThrow();
    await expect(s.service.start(historyUuid(800), 'bad')).rejects.toThrow();
    await expect(s.service.nextPage('bad')).rejects.toThrow();
    expect(s.repository.start).not.toHaveBeenCalled();
    expect(s.repository.nextPage).not.toHaveBeenCalled();
  });
  it('preserves an uncertain result and does not start a new run automatically', async () => {
    const s = setup();
    const error = new Error('commit reply lost');
    s.repository.nextPage.mockRejectedValue(error);
    await expect(s.service.nextPage(historyUuid(800))).rejects.toBe(error);
    expect(s.repository.nextPage).toHaveBeenCalledTimes(1);
    expect(s.repository.start).not.toHaveBeenCalled();
  });
});
