import { MongoAnimalMediaUploadRepository } from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  AnimalMediaUpload,
  PinnedMedia,
} from '../../../src/context/animal-media/domain/animal-media-upload';

describe('MongoAnimalMediaUploadRepository', () => {
  const ticket: AnimalMediaUpload = {
    id: 'upload-id',
    ownerId: 'owner',
    animalId: 'animal',
    finalKey: 'final',
    stagingKey: 'staging',
    mimeType: 'image/jpeg',
    size: 4,
    createdAt: '2026-10-25',
  };
  const pinned: PinnedMedia = {
    etag: 'source',
    versionId: 'version-1',
    size: 4,
    sha256: 'digest',
  };
  const sealed = { etag: 'final', versionId: 'version-2', size: 4 };
  const setup = () => {
    const exec = jest.fn().mockResolvedValue(ticket);
    const read = jest.fn();
    const readConcern = jest.fn();
    const lean = jest.fn();
    const chain = { exec, read, readConcern, lean };
    for (const method of [read, readConcern, lean])
      method.mockReturnValue(chain);
    const create = jest.fn().mockResolvedValue([ticket]);
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });
    const findOne = jest.fn().mockReturnValue(chain);
    return {
      repository: new MongoAnimalMediaUploadRepository({
        create,
        updateOne,
        findOne,
      } as never),
      create,
      updateOne,
      findOne,
      exec,
      read,
      readConcern,
    };
  };

  it('acknowledges issuance with majority and never overwrites/recycles an existing destination', async () => {
    const ctx = setup();
    await ctx.repository.create(ticket);
    expect(ctx.create).toHaveBeenCalledWith([ticket], { w: 'majority' });
    ctx.create.mockRejectedValueOnce({ code: 11000 });
    await expect(ctx.repository.create(ticket)).rejects.toThrow(
      'already been issued',
    );
    ctx.create.mockRejectedValueOnce(new Error('Majority unavailable'));
    await expect(ctx.repository.create(ticket)).rejects.toThrow(
      'Majority unavailable',
    );
  });

  it('reads from primary/majority so a recently issued upload cannot silently fall back to legacy', async () => {
    const ctx = setup();
    await ctx.repository.find('final');
    expect(ctx.findOne).toHaveBeenCalledWith({ finalKey: 'final' });
    expect(ctx.read).toHaveBeenCalledWith('primary');
    expect(ctx.readConcern).toHaveBeenCalledWith('majority');
  });

  it('pins only once, and a concurrent caller receives the winning source rather than its own candidate', async () => {
    const ctx = setup();
    ctx.exec.mockResolvedValue({ ...ticket, pinned });
    const losing = { ...pinned, etag: 'other', sha256: 'losing' };
    await expect(ctx.repository.pin('final', losing)).resolves.toMatchObject({
      pinned,
    });
    expect(ctx.updateOne).toHaveBeenCalledWith(
      {
        finalKey: 'final',
        pinned: { $exists: false },
        sealed: { $exists: false },
      },
      { $set: { pinned: losing } },
      { writeConcern: { w: 'majority' } },
    );
  });

  it('finds retired legacy sources by their unique source key with primary/majority reads', async () => {
    const ctx = setup();
    await ctx.repository.findLegacySource('old-key');
    expect(ctx.findOne).toHaveBeenCalledWith({
      stagingKey: 'old-key',
      legacy: { $exists: true },
    });
    expect(ctx.read).toHaveBeenCalledWith('primary');
    expect(ctx.readConcern).toHaveBeenCalledWith('majority');
  });

  it('does not treat a missing pinned record as a successful claim', async () => {
    const ctx = setup();
    await expect(ctx.repository.pin('final', pinned)).rejects.toThrow(
      'could not be pinned',
    );
  });

  it('seals only the pinned digest once and verifies a concurrent/uncertain result before returning', async () => {
    const ctx = setup();
    ctx.exec.mockResolvedValue({ ...ticket, pinned, sealed });
    await ctx.repository.seal('final', pinned.sha256, sealed);
    expect(ctx.updateOne).toHaveBeenCalledWith(
      {
        finalKey: 'final',
        'pinned.sha256': pinned.sha256,
        sealed: { $exists: false },
      },
      { $set: { sealed } },
      { writeConcern: { w: 'majority' } },
    );
    ctx.exec.mockResolvedValueOnce({
      ...ticket,
      pinned,
      sealed: { ...sealed, versionId: 'conflicting-version' },
    });
    await expect(
      ctx.repository.seal('final', pinned.sha256, sealed),
    ).rejects.toThrow('could not be confirmed as sealed');
    ctx.exec.mockResolvedValueOnce({ ...ticket, pinned });
    await expect(
      ctx.repository.seal('final', pinned.sha256, sealed),
    ).rejects.toThrow('could not be confirmed as sealed');
  });
});
