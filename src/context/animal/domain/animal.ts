import { AnimalId } from "./animalId";
import { AnimalName } from "./animalName";
import { AnimalBreed } from "./animalBreed";
import { AnimalSpecies } from "./animalSpecies";
import { AnimalCode } from "./animalCode";
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
import { UserId } from "../../user/domain/userId";
import { AnimalHousingType } from "./animalHousingType";
import { AnimalPurpose } from "./animalPurpose";
import { AnimalFeedingType } from "./animalFeedingType";
import { AnimalBirthType } from "./animalBirthType";
import { AnimalBirthCondition } from "./animalBirthCondition";

export type AnimalPrimitiveType = {
    id: string;
    name: string;
    species: string;
    breed: string;
    code: string;
    sex: string;
    reproductiveStatus: string;
    birthDate?: string;
    hasChip: boolean;
    isAssociationMember: boolean;
    temperament: string[];
    diagnosis: string[];
    ownerId: string;
    weight?: number;
    colorAndMarkings?: string;
    allergies?: string;
    housingType?: string;
    purpose?: string;
    feedingType?: string;
    birthType?: string;
    birthCondition?: string;
    profilePictureUrl?: string;
    createdAt?: string;
    updatedAt?: string;
    isAdopted?: boolean;
    adoptionSource?: string;
    adoptionPlaceName?: string;
};

export class Animal {
    id: AnimalId;
    name: AnimalName;
    species: AnimalSpecies;
    breed: AnimalBreed;
    code: AnimalCode;
    sex: AnimalSex;
    reproductiveStatus: AnimalReproductiveStatus;
    hasChip: AnimalHasChip;
    isAssociationMember: AnimalIsAssociationMember;
    temperament: AnimalTemperament;
    diagnosis: AnimalDiagnosis;
    ownerId: UserId;
    birthDate?: AnimalBirthDate;
    weight?: AnimalWeight;
    colorAndMarkings?: AnimalColorAndMarkings;
    allergies?: AnimalAllergies;
    housingType?: AnimalHousingType;
    purpose?: AnimalPurpose;
    feedingType?: AnimalFeedingType;
    birthType?: AnimalBirthType;
    birthCondition?: AnimalBirthCondition;
    profilePictureUrl?: string;
    createdAt?: string;
    updatedAt?: string;
    isAdopted?: boolean;
    adoptionSource?: string;
    adoptionPlaceName?: string;

    constructor(
        id: AnimalId,
        name: AnimalName,
        species: AnimalSpecies,
        breed: AnimalBreed,
        code: AnimalCode,
        sex: AnimalSex,
        reproductiveStatus: AnimalReproductiveStatus,
        hasChip: AnimalHasChip,
        isAssociationMember: AnimalIsAssociationMember,
        temperament: AnimalTemperament,
        diagnosis: AnimalDiagnosis,
        ownerId: UserId,
        birthDate?: AnimalBirthDate,
        weight?: AnimalWeight,
        colorAndMarkings?: AnimalColorAndMarkings,
        allergies?: AnimalAllergies,
        housingType?: AnimalHousingType,
        purpose?: AnimalPurpose,
        feedingType?: AnimalFeedingType,
        birthType?: AnimalBirthType,
        birthCondition?: AnimalBirthCondition,
        profilePictureUrl?: string,
        createdAt?: string,
        updatedAt?: string,
        isAdopted?: boolean,
        adoptionSource?: string,
        adoptionPlaceName?: string
    ) {
        this.id = id;
        this.name = name;
        this.species = species;
        this.breed = breed;
        this.code = code;
        this.sex = sex;
        this.reproductiveStatus = reproductiveStatus;
        this.hasChip = hasChip;
        this.isAssociationMember = isAssociationMember;
        this.temperament = temperament;
        this.diagnosis = diagnosis;
        this.ownerId = ownerId;
        this.birthDate = birthDate;
        this.weight = weight;
        this.colorAndMarkings = colorAndMarkings;
        this.allergies = allergies;
        this.housingType = housingType;
        this.purpose = purpose;
        this.feedingType = feedingType;
        this.birthType = birthType;
        this.birthCondition = birthCondition;
        this.profilePictureUrl = profilePictureUrl;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.isAdopted = isAdopted;
        this.adoptionSource = adoptionSource;
        this.adoptionPlaceName = adoptionPlaceName;
    }

    static fromPrimitives(plainData: AnimalPrimitiveType): Animal {
        return new Animal(
            new AnimalId(plainData.id),
            new AnimalName(plainData.name),
            new AnimalSpecies(plainData.species),
            new AnimalBreed(plainData.breed),
            new AnimalCode(plainData.code),
            new AnimalSex(plainData.sex),
            new AnimalReproductiveStatus(plainData.reproductiveStatus),
            new AnimalHasChip(plainData.hasChip),
            new AnimalIsAssociationMember(plainData.isAssociationMember),
            new AnimalTemperament(plainData.temperament),
            new AnimalDiagnosis(plainData.diagnosis),
            new UserId(plainData.ownerId),
            plainData.birthDate ? new AnimalBirthDate(plainData.birthDate) : undefined,
            plainData.weight ? new AnimalWeight(plainData.weight) : undefined,
            plainData.colorAndMarkings ? new AnimalColorAndMarkings(plainData.colorAndMarkings) : undefined,
            plainData.allergies ? new AnimalAllergies(plainData.allergies) : undefined,
            plainData.housingType ? new AnimalHousingType(plainData.housingType) : undefined,
            plainData.purpose ? new AnimalPurpose(plainData.purpose) : undefined,
            plainData.feedingType ? new AnimalFeedingType(plainData.feedingType) : undefined,
            plainData.birthType ? new AnimalBirthType(plainData.birthType) : undefined,
            plainData.birthCondition ? new AnimalBirthCondition(plainData.birthCondition) : undefined,
            plainData.profilePictureUrl,
            plainData.createdAt,
            plainData.updatedAt,
            plainData.isAdopted,
            plainData.adoptionSource,
            plainData.adoptionPlaceName
        );
    }

    toPrimitives(): AnimalPrimitiveType {
        return {
            id: this.id.value,
            name: this.name.value,
            species: this.species.value,
            breed: this.breed.value,
            code: this.code.value,
            sex: this.sex.value,
            reproductiveStatus: this.reproductiveStatus.value,
            birthDate: this.birthDate?.value,
            hasChip: this.hasChip.value,
            isAssociationMember: this.isAssociationMember.value,
            temperament: this.temperament.value,
            diagnosis: this.diagnosis.value,
            ownerId: this.ownerId.value,
            weight: this.weight?.value,
            colorAndMarkings: this.colorAndMarkings?.value,
            allergies: this.allergies?.value,
            housingType: this.housingType?.value,
            purpose: this.purpose?.value,
            feedingType: this.feedingType?.value,
            birthType: this.birthType?.value,
            birthCondition: this.birthCondition?.value,
            profilePictureUrl: this.profilePictureUrl,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            isAdopted: this.isAdopted,
            adoptionSource: this.adoptionSource,
            adoptionPlaceName: this.adoptionPlaceName
        };
    }
}

