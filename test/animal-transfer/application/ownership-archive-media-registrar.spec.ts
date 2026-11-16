import { OwnershipArchiveMediaRegistrar } from '../../../src/context/animal-transfer/application/ownership-archive-media-registrar';
import { registrationFixture } from '../fixtures/ownership-archive-media-registration.fixture';

describe('Explicit per-file media registrar', () => {
  const setup = () => {
    const s = registrationFixture();
    const repository = {
      registerFile: jest.fn().mockResolvedValue(s.registration),
    };
    return {
      ...s,
      repository,
      service: new OwnershipArchiveMediaRegistrar(repository),
    };
  };
  it('accepts only archive/file identities and returns PREPARED evidence, not a global completion', async () => {
    const s = setup();
    await expect(
      s.service.registerFile(s.archive.id, s.file.id),
    ).resolves.toEqual(s.registration);
    expect(s.repository.registerFile).toHaveBeenCalledWith(
      s.archive.id,
      s.file.id,
    );
    expect(s.service).not.toHaveProperty('publish');
    expect(s.service).not.toHaveProperty('start');
  });
  it.each(['short', 'A'.repeat(64), 'a'.repeat(64) + '\n', '../file', ''])(
    'rejects invalid file ID %s before persistence',
    async (fileId) => {
      const s = setup();
      await expect(
        s.service.registerFile(s.archive.id, fileId),
      ).rejects.toThrow();
      expect(s.repository.registerFile).not.toHaveBeenCalled();
    },
  );
  it('rejects an invalid archive ID before persistence', async () => {
    const s = setup();
    await expect(
      s.service.registerFile('invalid', s.file.id),
    ).rejects.toThrow();
    expect(s.repository.registerFile).not.toHaveBeenCalled();
  });
  it('preserves an uncertain commit error without retrying, compensating or claiming rollback', async () => {
    const s = setup();
    const error = new Error('commit acknowledgement lost');
    s.repository.registerFile.mockRejectedValueOnce(error);
    await expect(s.service.registerFile(s.archive.id, s.file.id)).rejects.toBe(
      error,
    );
    expect(s.repository.registerFile).toHaveBeenCalledTimes(1);
  });
});
