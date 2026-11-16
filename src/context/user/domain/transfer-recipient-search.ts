export enum TransferRecipientSearchBy {
  Name = 'NAME',
  Identification = 'IDENTIFICATION',
}

export type TransferRecipient = {
  id: string;
  name: string;
  identificationType: string;
  identificationNumber: string;
  profilePictureUrl?: string;
  countryId?: string;
  departmentId?: string;
  cityId?: string;
};

export interface TransferRecipientSearch {
  searchByName(
    query: string,
    excludedUserId: string,
    limit: number,
    afterId?: string,
  ): Promise<TransferRecipient[]>;
}
