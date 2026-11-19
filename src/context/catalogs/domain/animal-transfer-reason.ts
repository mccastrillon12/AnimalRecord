import { v5 as uuidv5 } from 'uuid';

export enum AnimalTransferReasonCode {
  PurchaseSale = 'PURCHASE_SALE',
  Adoption = 'ADOPTION',
  GiftDonation = 'GIFT_DONATION',
  PrimaryAccountChange = 'PRIMARY_ACCOUNT_CHANGE',
  Other = 'OTHER',
}

export type AnimalTransferReason = {
  id: string;
  code: AnimalTransferReasonCode;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export const INITIAL_ANIMAL_TRANSFER_REASONS: readonly AnimalTransferReason[] =
  [
    [AnimalTransferReasonCode.PurchaseSale, 'Venta/Compra'],
    [AnimalTransferReasonCode.Adoption, 'Adopción'],
    [AnimalTransferReasonCode.GiftDonation, 'Regalo/ Donación'],
    [
      AnimalTransferReasonCode.PrimaryAccountChange,
      'Cambio de cuenta principal',
    ],
    [AnimalTransferReasonCode.Other, 'Otro'],
  ].map(([code, name], index) => ({
    id: uuidv5(
      `https://animalrecord.app/catalogs/animal-transfer-reasons/${code}`,
      uuidv5.URL,
    ),
    code: code as AnimalTransferReasonCode,
    name,
    sortOrder: index + 1,
    isActive: true,
  }));

export enum AnimalTransferRejectionReasonCode {
  Unrecognized = 'UNRECOGNIZED_TRANSFER',
  CannotCare = 'CANNOT_ASSUME_RESPONSIBILITY',
  Other = 'OTHER',
}
export type AnimalTransferRejectionReason = Omit<
  AnimalTransferReason,
  'code'
> & {
  code: AnimalTransferRejectionReasonCode;
};
export const INITIAL_ANIMAL_TRANSFER_REJECTION_REASONS: readonly AnimalTransferRejectionReason[] =
  [
    [
      AnimalTransferRejectionReasonCode.Unrecognized,
      'Desconocimiento de transferencia',
    ],
    [
      AnimalTransferRejectionReasonCode.CannotCare,
      'No tiene la responsabilidad o recursos',
    ],
    [AnimalTransferRejectionReasonCode.Other, 'Otro'],
  ].map(([code, name], index) => ({
    id: uuidv5(
      `https://animalrecord.app/catalogs/animal-transfer-rejection-reasons/${code}`,
      uuidv5.URL,
    ),
    code: code as AnimalTransferRejectionReasonCode,
    name,
    sortOrder: index + 1,
    isActive: true,
  }));
