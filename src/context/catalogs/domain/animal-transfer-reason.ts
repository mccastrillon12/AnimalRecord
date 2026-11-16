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
    [AnimalTransferReasonCode.PurchaseSale, 'Compra / venta'],
    [AnimalTransferReasonCode.Adoption, 'Adopción'],
    [AnimalTransferReasonCode.GiftDonation, 'Regalo / donación'],
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
