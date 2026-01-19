import { AnimalCodeGenerator } from '../../../../src/context/animal/application/generators/animal-code-generator';
import { MongoCounterRepository } from '../../../../src/context/shared/infrastructure/persistence/mongo/mongo-counter-repository';
import { Model } from 'mongoose';
import { AnimalSpeciesEnum } from '../../../../src/context/animal/domain/animalSpecies';

describe('AnimalCodeGenerator', () => {
    let generator: AnimalCodeGenerator;
    let mockCounterRepository: MongoCounterRepository;

    beforeEach(() => {
        // Mock the repository directly
        mockCounterRepository = {
            getNextSequence: jest.fn()
        } as any;
        generator = new AnimalCodeGenerator(mockCounterRepository);
    });

    it('should generate correct code for DOG', async () => {
        (mockCounterRepository.getNextSequence as jest.Mock).mockResolvedValue(1);
        const code = await generator.generate(AnimalSpeciesEnum.DOG);
        expect(code).toBe('AR-C001');
    });

    it('should generate correct code for CAT', async () => {
        (mockCounterRepository.getNextSequence as jest.Mock).mockResolvedValue(15);
        const code = await generator.generate(AnimalSpeciesEnum.CAT);
        expect(code).toBe('AR-F015');
    });

    it('should generate correct code for BOVINE', async () => {
        (mockCounterRepository.getNextSequence as jest.Mock).mockResolvedValue(123);
        const code = await generator.generate(AnimalSpeciesEnum.BOVINE);
        expect(code).toBe('AR-B123');
    });

    it('should use different sequences for different species prefix', async () => {
        (mockCounterRepository.getNextSequence as jest.Mock).mockImplementation((key) => {
            if (key === 'animal_code_C') return Promise.resolve(10);
            if (key === 'animal_code_F') return Promise.resolve(5);
            return Promise.resolve(0);
        });

        const dogCode = await generator.generate(AnimalSpeciesEnum.DOG);
        const catCode = await generator.generate(AnimalSpeciesEnum.CAT);

        expect(dogCode).toBe('AR-C010');
        expect(catCode).toBe('AR-F005');
        expect(mockCounterRepository.getNextSequence).toHaveBeenCalledWith('animal_code_C');
        expect(mockCounterRepository.getNextSequence).toHaveBeenCalledWith('animal_code_F');
    });
});
