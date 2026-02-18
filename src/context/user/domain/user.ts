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
import { UserAuthMethod, UserAuthMethodEnum } from "./userAuthMethod";
import { UserAddress } from "./userAddress";
import { UserDepartment } from "./userDepartment";
import { UserResetPasswordCode } from "./userResetPasswordCode";

import { UserRole, UserRoleEnum } from "./userRole";

export type UserPrimitiveType = {
    id: string;
    name: string;
    identificationType: string;
    identificationNumber: string;
    country: string;
    department?: string;
    city?: string;
    address?: string;
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
    authMethod: string;
    googleId?: string;
    appleId?: string;
    microsoftId?: string;
    resetPasswordCode?: string;

    resetPasswordExpiration?: Date;
    pin?: string;
    isBiometricEnabled: boolean;
    resetPinCode?: string;
    resetPinExpiration?: Date;
};

export class User {
    id: UserId;
    name: UserName;
    identificationType: UserIdentificationType;
    identificationNumber: UserIdentificationNumber;
    country: UserCountry;
    department?: UserDepartment;
    city?: UserCity;
    address?: UserAddress;
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
    authMethod: UserAuthMethod;
    googleId?: string;
    appleId?: string;
    microsoftId?: string;
    resetPasswordCode?: UserResetPasswordCode;
    resetPasswordExpiration?: Date;
    pin?: string;
    isBiometricEnabled: boolean;
    resetPinCode?: string;
    resetPinExpiration?: Date;

    constructor(
        id: UserId,
        name: UserName,
        identificationType: UserIdentificationType,
        identificationNumber: UserIdentificationNumber,
        country: UserCountry,
        authMethod: UserAuthMethod, // Moved up
        department?: UserDepartment,
        city?: UserCity,
        address?: UserAddress,
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
        verificationCodeExpiration?: Date,
        googleId?: string,
        appleId?: string,
        microsoftId?: string,
        resetPasswordCode?: UserResetPasswordCode,
        resetPasswordExpiration?: Date,
        pin?: string,
        isBiometricEnabled?: boolean,
        resetPinCode?: string,
        resetPinExpiration?: Date
    ) {

        this.id = id;
        this.name = name;
        this.identificationType = identificationType;
        this.identificationNumber = identificationNumber;
        this.country = country;
        this.authMethod = authMethod;
        this.department = department;
        this.city = city;
        this.address = address;
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
        this.googleId = googleId;
        this.appleId = appleId;
        this.microsoftId = microsoftId;
        this.resetPasswordCode = resetPasswordCode;
        this.resetPasswordExpiration = resetPasswordExpiration;
        this.pin = pin;
        this.isBiometricEnabled = isBiometricEnabled || false;
        this.resetPinCode = resetPinCode;
        this.resetPinExpiration = resetPinExpiration;
    }

    static fromPrimitives(plainData: UserPrimitiveType): User {
        return new User(
            new UserId(plainData.id),
            new UserName(plainData.name),
            new UserIdentificationType(plainData.identificationType),
            new UserIdentificationNumber(plainData.identificationNumber),
            new UserCountry(plainData.country),
            new UserAuthMethod(plainData.authMethod || UserAuthMethodEnum.EMAIL), // Default to EMAIL for backward compatibility
            plainData.department ? new UserDepartment(plainData.department) : undefined,
            plainData.city ? new UserCity(plainData.city) : undefined,
            plainData.address ? new UserAddress(plainData.address) : undefined,
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
            plainData.verificationCodeExpiration,
            plainData.googleId,
            plainData.appleId,
            plainData.microsoftId,
            plainData.resetPasswordCode ? new UserResetPasswordCode(plainData.resetPasswordCode) : undefined,

            plainData.resetPasswordExpiration,
            plainData.pin,
            plainData.isBiometricEnabled,
            plainData.resetPinCode,
            plainData.resetPinExpiration
        );
    }

    toPrimitives(): UserPrimitiveType {
        return {
            id: this.id.value,
            name: this.name.value,
            identificationType: this.identificationType.value,
            identificationNumber: this.identificationNumber.value,
            country: this.country.value,
            department: this.department?.value,
            city: this.city?.value,
            address: this.address?.value,
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
            authMethod: this.authMethod.value,
            googleId: this.googleId,
            appleId: this.appleId,
            microsoftId: this.microsoftId,
            resetPasswordCode: this.resetPasswordCode?.value,
            resetPasswordExpiration: this.resetPasswordExpiration,
            pin: this.pin,
            isBiometricEnabled: this.isBiometricEnabled,
            resetPinCode: this.resetPinCode,
            resetPinExpiration: this.resetPinExpiration
        };
    }
}

export { UserAuthMethodEnum };
