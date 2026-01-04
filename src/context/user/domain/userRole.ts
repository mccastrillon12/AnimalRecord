export enum UserRoleEnum {
    PROPIETARIO_MASCOTA = 'PROPIETARIO_MASCOTA',
    VETERINARIO = 'VETERINARIO',
    LABORATORIO = 'LABORATORIO',
    OTRO = 'OTRO',
}

export class UserRole {
    readonly value: UserRoleEnum;

    constructor(value: UserRoleEnum | string) {
        this.validate(value);
        this.value = value as UserRoleEnum;
    }

    private validate(value: UserRoleEnum | string): void {
        if (!Object.values(UserRoleEnum).includes(value as UserRoleEnum)) {
            throw new Error(`Invalid role: ${value}. Usage: ${Object.values(UserRoleEnum).join(', ')}`);
        }
    }
}
