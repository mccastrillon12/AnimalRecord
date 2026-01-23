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
import { UserIsVerified } from "./userIsVerified";
import { UserVerificationCode } from "./userVerificationCode";
import { UserAuthMethod, UserAuthMethodEnum } from "./userAuthMethod"; // New

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
    isVerified: boolean;
    verificationCode?: string;
    verificationCodeExpiration?: Date;
    authMethod: string; // New
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
    isVerified: UserIsVerified;
    verificationCode?: UserVerificationCode;
    verificationCodeExpiration?: Date;
    authMethod: UserAuthMethod; // New

    constructor(
        id: UserId,
        name: UserName,
        identificationType: UserIdentificationType,
        identificationNumber: UserIdentificationNumber,
        country: UserCountry,
        authMethod: UserAuthMethod, // Moved up
        city?: UserCity,
        email?: UserEmail,
        cellPhone?: UserCellPhone,
        professionalCard?: UserProfessionalCard,
        animalTypes?: UserAnimalTypes,
        services?: UserServices,
        isHomeDelivery?: UserIsHomeDelivery,
        roles?: UserRole[],
        password?: string,
        refreshToken?: string,
        isVerified?: UserIsVerified,
        verificationCode?: UserVerificationCode,
        verificationCodeExpiration?: Date
    ) {
        this.id = id;
        this.name = name;
        this.identificationType = identificationType;
        this.identificationNumber = identificationNumber;
        this.country = country;
        this.authMethod = authMethod;
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
        this.isVerified = isVerified || new UserIsVerified(false);
        this.verificationCode = verificationCode;
        this.verificationCodeExpiration = verificationCodeExpiration;
    }

    static fromPrimitives(plainData: UserPrimitiveType): User {
        return new User(
            new UserId(plainData.id),
            new UserName(plainData.name),
            new UserIdentificationType(plainData.identificationType),
            new UserIdentificationNumber(plainData.identificationNumber),
            new UserCountry(plainData.country),
            new UserAuthMethod(plainData.authMethod || UserAuthMethodEnum.EMAIL), // Default to EMAIL for backward compatibility
            plainData.city ? new UserCity(plainData.city) : undefined,
            plainData.email ? new UserEmail(plainData.email) : undefined,
            plainData.cellPhone ? new UserCellPhone(plainData.cellPhone) : undefined,
            plainData.professionalCard ? new UserProfessionalCard(plainData.professionalCard) : undefined,
            plainData.animalTypes ? new UserAnimalTypes(plainData.animalTypes) : undefined,
            plainData.services ? new UserServices(plainData.services) : undefined,
            plainData.isHomeDelivery !== undefined ? new UserIsHomeDelivery(plainData.isHomeDelivery) : undefined,
            plainData.roles ? plainData.roles.map(role => new UserRole(role)) : undefined,
            plainData.password,
            plainData.refreshToken,
            new UserIsVerified(plainData.isVerified),
            plainData.verificationCode ? new UserVerificationCode(plainData.verificationCode) : undefined,
            plainData.verificationCodeExpiration
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
            refreshToken: this.refreshToken,
            isVerified: this.isVerified.value,
            verificationCode: this.verificationCode?.value,
            verificationCodeExpiration: this.verificationCodeExpiration,
            authMethod: this.authMethod.value
        };
    }
}

export { UserAuthMethodEnum };
