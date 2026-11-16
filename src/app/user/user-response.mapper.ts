import { User } from '../../context/user/domain/user';

/** Explicit allowlist: domain persistence primitives contain authentication secrets. */
export function toUserResponse(user: User) {
  const data = user.toPrimitives();
  return {
    id: data.id,
    name: data.name,
    identificationType: data.identificationType,
    identificationNumber: data.identificationNumber,
    countryId: data.country,
    departmentId: data.department,
    cityId: data.city,
    // Preserve existing aliases used by older mobile versions.
    country: data.country,
    department: data.department,
    city: data.city,
    address: data.address,
    email: data.email,
    cellPhone: data.cellPhone,
    professionalCard: data.professionalCard,
    animalTypes: data.animalTypes,
    services: data.services,
    isHomeDelivery: data.isHomeDelivery,
    roles: data.roles,
    isVerified: data.isVerified,
    authMethod: data.authMethod,
    isBiometricEnabled: data.isBiometricEnabled,
    profilePictureUrl: data.profilePictureUrl,
    securityLastUpdated: data.securityLastUpdated,
  };
}
