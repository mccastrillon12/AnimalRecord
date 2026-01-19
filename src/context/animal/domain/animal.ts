import { AnimalId } from "./animalId";
import { AnimalName } from "./animalName";
import { AnimalBreed } from "./animalBreed";
import { AnimalSex } from "./animalSex";
import { AnimalReproductiveStatus } from "./animalReproductiveStatus";
import { AnimalBirthDate } from "./animalBirthDate";
import { AnimalHasChip } from "./animalHasChip";
import { AnimalIsAssociationMember } from "./animalIsAssociationMember";
import { AnimalTemperament } from "./animalTemperament";
import { AnimalDiagnosis } from "./animalDiagnosis";
import { AnimalWeight } from "./animalWeight";
import { AnimalColorAndMarkings } from "./animalColorAndMarkings";
import { AnimalAllergies } from "./animalAllergies";

export type AnimalPrimitiveType = {
    id: string;
    name: string;
    breed: string;
    sex: string;
    reproductiveStatus: string;
    birthDate: string;
    hasChip: boolean;
    isAssociationMember: boolean;
    temperament: string[];
    diagnosis: string[];
    weight?: number;
    colorAndMarkings?: string;
    allergies?: string;
};

export class Animal {
    id: AnimalId;
    name: AnimalName;
    breed: AnimalBreed;
    sex: AnimalSex;
    reproductiveStatus: AnimalReproductiveStatus;
    birthDate: AnimalBirthDate;
    hasChip: AnimalHasChip;
    isAssociationMember: AnimalIsAssociationMember;
    temperament: AnimalTemperament;
    diagnosis: AnimalDiagnosis;
    weight?: AnimalWeight;
    colorAndMarkings?: AnimalColorAndMarkings;
    allergies?: AnimalAllergies;

    constructor(
        id: AnimalId,
        name: AnimalName,
        breed: AnimalBreed,
        sex: AnimalSex,
        reproductiveStatus: AnimalReproductiveStatus,
        birthDate: AnimalBirthDate,
        hasChip: AnimalHasChip,
        isAssociationMember: AnimalIsAssociationMember,
        temperament: AnimalTemperament,
        diagnosis: AnimalDiagnosis,
        weight?: AnimalWeight,
        colorAndMarkings?: AnimalColorAndMarkings,
        allergies?: AnimalAllergies
    ) {
        this.id = id;
        this.name = name;
        this.breed = breed;
        this.sex = sex;
        this.reproductiveStatus = reproductiveStatus;
        this.birthDate = birthDate;
        this.hasChip = hasChip;
        this.isAssociationMember = isAssociationMember;
        this.temperament = temperament;
        this.diagnosis = diagnosis;
        this.weight = weight;
        this.colorAndMarkings = colorAndMarkings;
        this.allergies = allergies;
    }

    static fromPrimitives(plainData: AnimalPrimitiveType): Animal {
        return new Animal(
            new AnimalId(plainData.id),
            new AnimalName(plainData.name),
            new AnimalBreed(plainData.breed),
            new AnimalSex(plainData.sex),
            new AnimalReproductiveStatus(plainData.reproductiveStatus),
            new AnimalBirthDate(plainData.birthDate),
            new AnimalHasChip(plainData.hasChip),
            new AnimalIsAssociationMember(plainData.isAssociationMember),
            new AnimalTemperament(plainData.temperament),
            new AnimalDiagnosis(plainData.diagnosis),
            plainData.weight ? new AnimalWeight(plainData.weight) : undefined,
            plainData.colorAndMarkings ? new AnimalColorAndMarkings(plainData.colorAndMarkings) : undefined,
            plainData.allergies ? new AnimalAllergies(plainData.allergies) : undefined
        );
    }

    toPrimitives(): AnimalPrimitiveType {
        return {
            id: this.id.value,
            name: this.name.value,
            breed: this.breed.value,
            sex: this.sex.value,
            reproductiveStatus: this.reproductiveStatus.value,
            birthDate: this.birthDate.value,
            hasChip: this.hasChip.value,
            isAssociationMember: this.isAssociationMember.value,
            temperament: this.temperament.value,
            diagnosis: this.diagnosis.value,
            weight: this.weight?.value,
            colorAndMarkings: this.colorAndMarkings?.value,
            allergies: this.allergies?.value
        };
    }
}
