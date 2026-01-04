import { UserId } from "./userId";
import { UserName } from "./userName";
import { UserIdentificationType } from "./userIdentificationType";
import { UserIdentificationNumber } from "./userIdentificationNumber";
import { UserCountry } from "./userCountry";
import { UserCity } from "./userCity";
import { UserEmail } from "./userEmail";
import { UserCellPhone } from "./userCellPhone";
import { UserProfessionalCard } from "./userProfessionalCard";
import { UserAnimalTypes } from "./userAnimalTypes";
import { UserServices } from "./userServices";
import { UserIsHomeDelivery } from "./userIsHomeDelivery";

export type UserPrimitiveType = {
    id: string;
    name: string;
    identificationType: string;
    identificationNumber: string;
    country: string;
    city: string;
    email: string;
    cellPhone: string;
    professionalCard: string;
    animalTypes: string[];
    services: string[];
    isHomeDelivery: boolean;
    password?: string;
    refreshToken?: string;
};

export class User {
    id: UserId;
    name: UserName;
    identificationType: UserIdentificationType;
    identificationNumber: UserIdentificationNumber;
    country: UserCountry;
    city: UserCity;
    email: UserEmail;
    cellPhone: UserCellPhone;
    professionalCard: UserProfessionalCard;
    animalTypes: UserAnimalTypes;
    services: UserServices;
    isHomeDelivery: UserIsHomeDelivery;
    password?: string;
    refreshToken?: string;

    constructor(
        id: UserId,
        name: UserName,
        identificationType: UserIdentificationType,
        identificationNumber: UserIdentificationNumber,
        country: UserCountry,
        city: UserCity,
        email: UserEmail,
        cellPhone: UserCellPhone,
        professionalCard: UserProfessionalCard,
        animalTypes: UserAnimalTypes,
        services: UserServices,
        isHomeDelivery: UserIsHomeDelivery,
        password?: string,
        refreshToken?: string
    ) {
        this.id = id;
        this.name = name;
        this.identificationType = identificationType;
        this.identificationNumber = identificationNumber;
        this.country = country;
        this.city = city;
        this.email = email;
        this.cellPhone = cellPhone;
        this.professionalCard = professionalCard;
        this.animalTypes = animalTypes;
        this.services = services;
        this.isHomeDelivery = isHomeDelivery;
        this.password = password;
        this.refreshToken = refreshToken;
    }

    static fromPrimitives(plainData: UserPrimitiveType): User {
        return new User(
            new UserId(plainData.id),
            new UserName(plainData.name),
            new UserIdentificationType(plainData.identificationType),
            new UserIdentificationNumber(plainData.identificationNumber),
            new UserCountry(plainData.country),
            new UserCity(plainData.city),
            new UserEmail(plainData.email),
            new UserCellPhone(plainData.cellPhone),
            new UserProfessionalCard(plainData.professionalCard),
            new UserAnimalTypes(plainData.animalTypes),
            new UserServices(plainData.services),
            new UserIsHomeDelivery(plainData.isHomeDelivery),
            plainData.password,
            plainData.refreshToken
        );
    }

    toPrimitives(): UserPrimitiveType {
        return {
            id: this.id.value,
            name: this.name.value,
            identificationType: this.identificationType.value,
            identificationNumber: this.identificationNumber.value,
            country: this.country.value,
            city: this.city.value,
            email: this.email.value,
            cellPhone: this.cellPhone.value,
            professionalCard: this.professionalCard.value,
            animalTypes: this.animalTypes.value,
            services: this.services.value,
            isHomeDelivery: this.isHomeDelivery.value,
            password: this.password,
            refreshToken: this.refreshToken
        };
    }
}
