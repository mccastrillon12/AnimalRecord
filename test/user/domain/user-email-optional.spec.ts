import { User } from '../../../src/context/user/domain/user';
import { UserId } from '../../../src/context/user/domain/userId';
import { UserName } from '../../../src/context/user/domain/userName';
import { UserIdentificationType } from '../../../src/context/user/domain/userIdentificationType';
import { UserIdentificationNumber } from '../../../src/context/user/domain/userIdentificationNumber';
import { UserCountry } from '../../../src/context/user/domain/userCountry';

describe('User Entity - Optional Email', () => {
    const plainUserNoEmail = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John Doe',
        identificationType: 'CC',
        identificationNumber: '123456789',
        country: 'Colombia'
    };

    it('should create a User instance without email', () => {
        const user = User.fromPrimitives(plainUserNoEmail);

        expect(user).toBeInstanceOf(User);
        expect(user.email).toBeUndefined();
        expect(user.id.value).toBe(plainUserNoEmail.id);
    });

    it('should convert User instance without email to primitives', () => {
        const user = User.fromPrimitives(plainUserNoEmail);
        const primitives = user.toPrimitives();

        expect(primitives.email).toBeUndefined();
        expect(primitives.id).toBe(plainUserNoEmail.id);
    });
});
