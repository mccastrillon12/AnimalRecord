import { UserEmail } from '../../../src/context/user/domain/userEmail';

describe('UserEmail Value Object', () => {
    it('should create a valid UserEmail', () => {
        const email = 'test@example.com';
        const userEmail = new UserEmail(email);
        expect(userEmail.value).toBe(email);
    });

    // Add validation tests here if/when validation logic is implemented in the Value Object
    // For example:
    // it('should throw error for invalid email', () => {
    //     expect(() => new UserEmail('invalid')).toThrow();
    // });
});
