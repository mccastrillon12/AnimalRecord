import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { MedicalDocumentAnimalAccess } from '../../../src/context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentType } from '../../../src/context/medical-document/domain/medical-document';

describe('MedicalDocumentFinder', () => {
  const animalId = 'animal-id';
  const ownerId = 'owner-id';

  function createFinder() {
    const findAcceptedByAnimalId = jest.fn().mockResolvedValue([]);
    const findOwnedAnimals = jest.fn().mockResolvedValue(new Map());
    const repository = {
      findAcceptedByAnimalId,
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const animalAccess = {
      findOwnedAnimals,
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;

    return {
      finder: new MedicalDocumentFinder(repository, animalAccess),
      findAcceptedByAnimalId,
      findOwnedAnimals,
    };
  }

  it('filters accepted documents by their final category', async () => {
    const { finder, findAcceptedByAnimalId, findOwnedAnimals } = createFinder();

    await finder.findByAnimal(
      animalId,
      ownerId,
      MedicalDocumentType.Prescription,
    );

    expect(findOwnedAnimals).toHaveBeenCalledWith([animalId], ownerId);
    expect(findAcceptedByAnimalId).toHaveBeenCalledWith(
      animalId,
      MedicalDocumentType.Prescription,
    );
  });

  it('returns all accepted categories when the filter is omitted', async () => {
    const { finder, findAcceptedByAnimalId } = createFinder();

    await finder.findByAnimal(animalId, ownerId);

    expect(findAcceptedByAnimalId).toHaveBeenCalledWith(animalId, undefined);
  });
});
