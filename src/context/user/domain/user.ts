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

import { UserRole, UserRoleEnum } from "./userRole";

export type UserPrimitiveType = {
    id: string;
    name: string;
    identificationType: string;
    identificationNumber: string;
    country: string;
    city?: string;
    email?: string;
    cellPhone?: string;
    professionalCard?: string;
    animalTypes?: string[];
    services?: string[];
    isHomeDelivery?: boolean;
    roles?: string[];
    password?: string;
    refreshToken?: string;
};

export class User {
    id: UserId;
    name: UserName;
    identificationType: UserIdentificationType;
    identificationNumber: UserIdentificationNumber;
    country: UserCountry;
    city?: UserCity;
    email?: UserEmail;
    cellPhone?: UserCellPhone;
    professionalCard?: UserProfessionalCard;
    animalTypes?: UserAnimalTypes;
    services?: UserServices;
    isHomeDelivery?: UserIsHomeDelivery;
    roles?: UserRole[];
    password?: string;
    refreshToken?: string;

    constructor(
        id: UserId,
        name: UserName,
        identificationType: UserIdentificationType,
        identificationNumber: UserIdentificationNumber,
        country: UserCountry,
        city?: UserCity,
        email?: UserEmail,
        cellPhone?: UserCellPhone,
        professionalCard?: UserProfessionalCard,
        animalTypes?: UserAnimalTypes,
        services?: UserServices,
        isHomeDelivery?: UserIsHomeDelivery,
        roles?: UserRole[],
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
        this.roles = roles;
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
            plainData.city ? new UserCity(plainData.city) : undefined,
            plainData.email ? new UserEmail(plainData.email) : undefined,
            plainData.cellPhone ? new UserCellPhone(plainData.cellPhone) : undefined,
            plainData.professionalCard ? new UserProfessionalCard(plainData.professionalCard) : undefined,
            plainData.animalTypes ? new UserAnimalTypes(plainData.animalTypes) : undefined,
            plainData.services ? new UserServices(plainData.services) : undefined,
            plainData.isHomeDelivery !== undefined ? new UserIsHomeDelivery(plainData.isHomeDelivery) : undefined,
            plainData.roles ? plainData.roles.map(role => new UserRole(role)) : undefined,
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
            city: this.city?.value,
            email: this.email?.value,
            cellPhone: this.cellPhone?.value,
            professionalCard: this.professionalCard?.value,
            animalTypes: this.animalTypes?.value,
            services: this.services?.value,
            isHomeDelivery: this.isHomeDelivery?.value,
            roles: this.roles?.map(role => role.value),
            password: this.password,
            refreshToken: this.refreshToken
        };
    }
}
