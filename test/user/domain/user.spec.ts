import { User } from '../../../src/context/user/domain/user';
import { UserId } from '../../../src/context/user/domain/userId';
import { UserName } from '../../../src/context/user/domain/userName';
import { UserIdentificationType } from '../../../src/context/user/domain/userIdentificationType';
import { UserIdentificationNumber } from '../../../src/context/user/domain/userIdentificationNumber';
import { UserCountry } from '../../../src/context/user/domain/userCountry';
import { UserCity } from '../../../src/context/user/domain/userCity';
import { UserEmail } from '../../../src/context/user/domain/userEmail';
import { UserCellPhone } from '../../../src/context/user/domain/userCellPhone';
import { UserProfessionalCard } from '../../../src/context/user/domain/userProfessionalCard';
import { UserAnimalTypes } from '../../../src/context/user/domain/userAnimalTypes';
import { UserServices } from '../../../src/context/user/domain/userServices';
import { UserIsHomeDelivery } from '../../../src/context/user/domain/userIsHomeDelivery';

describe('User Entity', () => {
    const plainUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John Doe',
        identificationType: 'CC',
        identificationNumber: '123456789',
        country: 'Colombia',
        city: 'Bogota',
        email: 'john.doe@example.com',
        cellPhone: '3001234567',
        professionalCard: 'TP-123456',
        animalTypes: ['Dog', 'Cat'],
        services: ['Consultation'],
        isHomeDelivery: true,
        roles: ['PROPIETARIO_MASCOTA'],
        password: 'hashedPassword',
        refreshToken: 'hashedRefreshToken'
    };

    it('should create a User instance from primitives', () => {
        const user = User.fromPrimitives(plainUser);

        expect(user).toBeInstanceOf(User);
        expect(user.id).toBeInstanceOf(UserId);
        expect(user.name.value).toBe(plainUser.name);
        expect(user.identificationType.value).toBe(plainUser.identificationType);
        expect(user.identificationNumber.value).toBe(plainUser.identificationNumber);
        expect(user.country.value).toBe(plainUser.country);
        expect(user.city.value).toBe(plainUser.city);
        expect(user.email.value).toBe(plainUser.email);
        expect(user.cellPhone.value).toBe(plainUser.cellPhone);
        expect(user.professionalCard.value).toBe(plainUser.professionalCard);
        expect(user.animalTypes.value).toEqual(plainUser.animalTypes);
        expect(user.services.value).toEqual(plainUser.services);
        expect(user.isHomeDelivery.value).toBe(plainUser.isHomeDelivery);
        expect(user.roles.map(r => r.value)).toEqual(plainUser.roles);
        expect(user.password).toBe(plainUser.password);
        expect(user.refreshToken).toBe(plainUser.refreshToken);
    });

    it('should convert User instance to primitives', () => {
        const user = User.fromPrimitives(plainUser);
        const primitives = user.toPrimitives();

        expect(primitives).toEqual(plainUser);
    });
});
