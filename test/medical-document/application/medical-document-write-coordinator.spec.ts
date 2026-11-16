import { MedicalDocumentWriteCoordinator } from '../../../src/context/medical-document/application/medical-document-write-coordinator';
import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';

describe('MedicalDocumentWriteCoordinator', () => {
  const setup = () => {
    const run = jest
      .fn()
      .mockImplementation(
        (_ids: string[], _owner: string, operation: () => Promise<unknown>) =>
          operation(),
      );
    const anchor = {
      animalIds: ['a'],
      ownerId: 'owner',
      documentGroupId: 'group',
    };
    const findById = jest.fn().mockResolvedValue(anchor);
    const findAcceptedByGroupId = jest.fn().mockResolvedValue([]);
    return {
      coordinator: new MedicalDocumentWriteCoordinator(
        { run } as unknown as AnimalWriteCoordinator,
        { findById } as unknown as MedicalDocumentFinder,
        { findAcceptedByGroupId } as unknown as MedicalDocumentRepository,
      ),
      run,
      findById,
      findAcceptedByGroupId,
    };
  };

  it('covers every animal in multi-animal analysis/review/delete, re-reading after claim', async () => {
    const { coordinator, run, findById } = setup();
    findById.mockResolvedValue({ animalIds: ['a', 'b'] });
    const operation = jest.fn().mockResolvedValue('saved');
    await expect(
      coordinator.forDocuments(['document'], 'owner', operation),
    ).resolves.toBe('saved');
    expect(run).toHaveBeenCalledWith(
      ['a', 'b'],
      'owner',
      expect.any(Function),
      { kind: 'UNSPECIFIED' },
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('aborts before mutation if an association outside the claims appears', async () => {
    const { coordinator, findById } = setup();
    findById
      .mockResolvedValueOnce({ animalIds: ['a'] })
      .mockResolvedValueOnce({ animalIds: ['a', 'b'] });
    const operation = jest.fn();
    await expect(
      coordinator.forDocuments(['document'], 'owner', operation),
    ).rejects.toThrow('associations changed');
    expect(operation).not.toHaveBeenCalled();
  });

  it('claims legacy siblings as well as selected animals before replacement normalization', async () => {
    const { coordinator, findAcceptedByGroupId, run } = setup();
    findAcceptedByGroupId.mockResolvedValue([
      { ownerId: 'owner', animalIds: ['b', 'c'] },
      { ownerId: 'owner', animalIds: ['d'] },
    ]);
    await coordinator.forGroup('document', 'owner', ['a'], () =>
      Promise.resolve(),
    );
    expect(run).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      'owner',
      expect.any(Function),
      { kind: 'UNSPECIFIED' },
    );
  });

  it('keeps normalized related-document reads available without acquiring write claims', async () => {
    const { coordinator, findAcceptedByGroupId, run } = setup();
    findAcceptedByGroupId.mockResolvedValue([
      { ownerId: 'owner', animalIds: ['b'] },
    ]);
    const operation = jest.fn().mockResolvedValue('read');
    await expect(
      coordinator.forGroup('document', 'owner', [], operation),
    ).resolves.toBe('read');
    expect(run).not.toHaveBeenCalled();
  });

  it('does claim every legacy animal for related-document normalization', async () => {
    const { coordinator, findAcceptedByGroupId, run } = setup();
    findAcceptedByGroupId.mockResolvedValue([
      { ownerId: 'owner', animalIds: ['a', 'b'] },
    ]);
    await coordinator.forGroup('document', 'owner', [], () =>
      Promise.resolve(),
    );
    expect(run).toHaveBeenCalledWith(
      ['a', 'b'],
      'owner',
      expect.any(Function),
      { kind: 'UNSPECIFIED' },
    );
  });

  it('rejects a mixed-owner legacy group before invoking normalization', async () => {
    const { coordinator, findAcceptedByGroupId, run } = setup();
    findAcceptedByGroupId.mockResolvedValue([
      { ownerId: 'foreign', animalIds: ['a', 'b'] },
    ]);
    const operation = jest.fn();
    await expect(
      coordinator.forGroup('document', 'owner', [], operation),
    ).rejects.toThrow('another user');
    expect(run).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
});
