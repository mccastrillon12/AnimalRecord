import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TransferRecipient,
  TransferRecipientSearch,
} from '../../../domain/transfer-recipient-search';
import { UserDocument, UserEntity } from './user.schema';

type RecipientRecord = Pick<
  UserEntity,
  | 'id'
  | 'name'
  | 'identificationType'
  | 'identificationNumber'
  | 'profilePictureUrl'
  | 'country'
  | 'department'
  | 'city'
>;

// Match existing names with or without accents without a migration or regex input.
export function literalNamePattern(term: string): string {
  const variants: Record<string, string> = {
    a: '[aàáâãäå]',
    e: '[eèéêë]',
    i: '[iìíîï]',
    o: '[oòóôõö]',
    u: '[uùúûü]',
    n: '[nñ]',
    c: '[cç]',
  };
  return [
    ...term
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  ]
    .map(
      (character) =>
        variants[character] || character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
}

@Injectable()
export class MongoTransferRecipientSearch implements TransferRecipientSearch {
  constructor(
    @InjectModel(UserEntity.name) private readonly model: Model<UserDocument>,
  ) {}

  async searchByName(
    query: string,
    excludedUserId: string,
    limit: number,
    afterId?: string,
  ): Promise<TransferRecipient[]> {
    const nameFilters = query.split(' ').map((term) => ({
      name: { $regex: literalNamePattern(term), $options: 'i' },
    }));
    const records = await this.model
      .find({
        id: { $ne: excludedUserId, ...(afterId ? { $gt: afterId } : {}) },
        $and: nameFilters,
      })
      .select({
        _id: 0,
        id: 1,
        name: 1,
        identificationType: 1,
        identificationNumber: 1,
        profilePictureUrl: 1,
        country: 1,
        department: 1,
        city: 1,
      })
      .sort({ id: 1 })
      .limit(limit)
      .lean<RecipientRecord[]>()
      .exec();
    return records.map((record) => ({
      id: record.id,
      name: record.name,
      identificationType: record.identificationType,
      identificationNumber: record.identificationNumber,
      profilePictureUrl: record.profilePictureUrl,
      countryId: record.country,
      departmentId: record.department,
      cityId: record.city,
    }));
  }
}
