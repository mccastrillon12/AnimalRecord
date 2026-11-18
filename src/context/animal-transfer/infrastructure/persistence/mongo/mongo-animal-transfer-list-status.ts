import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  AnimalTransferListStatus,
  LiveAnimalTransferStatus,
} from '../../../application/animal-transfer-list-status';
import {
  TRANSFER_REQUEST_CLAIM_MODEL,
  type RequestClaim,
} from './transfer-request.schema';

@Injectable()
export class MongoAnimalTransferListStatus implements AnimalTransferListStatus {
  constructor(
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    private readonly claims: Model<RequestClaim>,
  ) {}

  async read(animalIds: readonly string[]) {
    const rows = await this.claims
      .find({ _id: { $in: animalIds } })
      .select({ _id: 1, acceptanceOperationId: 1 })
      .lean()
      .exec();
    return new Map<string, LiveAnimalTransferStatus>(
      rows.map(({ _id, acceptanceOperationId }) => [
        _id,
        acceptanceOperationId ? 'PROCESSING' : 'PENDING',
      ]),
    );
  }
}
