import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity } from '../../../../user/infrastructure/persistence/mongo/user.schema';
import {
  AnimalOwnerHistory,
  AnimalOwnerHistoryEntry,
} from '../../../application/animal-owner-history';
import { TransferRequestRecord } from '../../../domain/transfer-request';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import { TRANSFER_REQUEST_MODEL } from './transfer-request.schema';
import { ForbiddenError } from '../../../../shared/domain/errors/ForbiddenError';

@Injectable()
export class MongoAnimalOwnerHistory implements AnimalOwnerHistory {
  constructor(
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(TRANSFER_REQUEST_MODEL)
    private readonly requests: Model<TransferRequestRecord>,
    @InjectModel(UserEntity.name) private readonly users: Model<UserEntity>,
  ) {}

  async read(
    animal: { id: string; ownerId: string; createdAt?: string },
    throughVersion?: number,
  ): Promise<readonly AnimalOwnerHistoryEntry[]> {
    const periods = await this.periods
      .find({ animalId: animal.id })
      .sort({ ownershipVersion: 1 })
      .lean()
      .exec();
    if (!periods.length) return [];
    const authorized =
      throughVersion === undefined
        ? periods.find(
            (period) => period.status === AnimalOwnershipPeriodStatus.Active,
          )
        : periods.find(
            (period) =>
              period.ownershipVersion === throughVersion &&
              period.status === AnimalOwnershipPeriodStatus.Closed,
          );
    if (periods.length && authorized?.ownerId !== animal.ownerId)
      throw new ForbiddenError(
        'The ownership history is outside this owner period',
      );
    const transferIds = periods.flatMap((period) =>
      period.sourceTransferId ? [period.sourceTransferId] : [],
    );
    const requests = transferIds.length
      ? await this.requests
          .find({ _id: { $in: transferIds } })
          .select({
            _id: 1,
            senderId: 1,
            senderName: 1,
            recipientId: 1,
            recipientName: 1,
          })
          .lean()
          .exec()
      : [];
    const names = new Map(requests.map((row) => [row._id, row]));
    const visible = periods.filter(
      (period) =>
        throughVersion === undefined ||
        period.ownershipVersion <= throughVersion,
    );
    const ownerIds = [
      ...new Set(
        visible.length
          ? visible.map((period) => period.ownerId)
          : [animal.ownerId],
      ),
    ];
    const users = await this.users
      .find({ id: { $in: ownerIds } })
      .select({ _id: 0, id: 1, name: 1 })
      .lean()
      .exec();
    const currentNames = new Map(users.map((user) => [user.id, user.name]));
    return visible.map((period) => {
      const start = period.sourceTransferId
        ? names.get(period.sourceTransferId)
        : undefined;
      const next = periods.find(
        (row) => row.ownershipVersion === period.ownershipVersion + 1,
      );
      const end = next?.sourceTransferId
        ? names.get(next.sourceTransferId)
        : undefined;
      const ownerName =
        start?.recipientId === period.ownerId
          ? start.recipientName
          : end?.senderId === period.ownerId
            ? end.senderName
            : currentNames.get(period.ownerId);
      return {
        ownerId: period.ownerId,
        ownerName,
        ownershipVersion: period.ownershipVersion,
        ...(period.startedAtKnown && period.startedAt
          ? {
              startedAt: period.startedAt,
              ...(period.sourceTransferId
                ? { transferredAt: period.startedAt }
                : {}),
            }
          : {}),
        ...(period.endedAt ? { endedAt: period.endedAt } : {}),
        isCurrent: period.status === AnimalOwnershipPeriodStatus.Active,
      };
    });
  }
}
