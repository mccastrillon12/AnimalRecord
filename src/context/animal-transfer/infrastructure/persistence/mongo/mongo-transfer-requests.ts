import {
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, STATES } from 'mongoose';
import { AnimalEntity } from '../../../../animal/infrastructure/persistence/mongo/animal.schema';
import { UserEntity } from '../../../../user/infrastructure/persistence/mongo/user.schema';
import { AnimalTransferReasonEntity } from '../../../../catalogs/infrastructure/persistence/mongo/catalogs.schema';
import { AnimalTransferReasonCode } from '../../../../catalogs/domain/animal-transfer-reason';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import {
  RequestAnimal,
  RequestListAfter,
  TransferRequestItem,
  TransferRequestRecord,
  TransferRequestStore,
  TransferRequestTransaction,
} from '../../../domain/transfer-request';
import { TransferRequestCollision } from '../../../domain/transfer-request';
import { transferRecordId } from '../../../application/transfer-requests';
import { AnimalOwnershipControlEntity } from './animal-ownership.schema';
import {
  TRANSFER_REQUEST_MODELS,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TRANSFER_EVENT_MODEL,
  RequestClaim,
  TransferNotice,
  TransferOutbox,
  TransferEvent,
} from './transfer-request.schema';

@Injectable()
export class MongoTransferRequests implements TransferRequestStore {
  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL)
    private readonly requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL)
    private readonly itemRows: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    private readonly claims: Model<RequestClaim>,
    @InjectModel(TRANSFER_NOTICE_MODEL)
    private readonly notices: Model<TransferNotice>,
    @InjectModel(TRANSFER_OUTBOX_MODEL)
    private readonly outbox: Model<TransferOutbox>,
    @InjectModel(TRANSFER_EVENT_MODEL)
    private readonly events: Model<TransferEvent>,
    @InjectModel(UserEntity.name) private readonly users: Model<UserEntity>,
    @InjectModel(AnimalTransferReasonEntity.name)
    private readonly reasons: Model<AnimalTransferReasonEntity>,
    @InjectModel(AnimalEntity.name)
    private readonly animals: Model<AnimalEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
  ) {}
  async transaction<T>(
    work: (tx: TransferRequestTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = this.requests.db;
    let session: ClientSession | undefined;
    try {
      if (
        connection.readyState !== STATES.connected ||
        !connection.db ||
        [
          this.itemRows,
          this.claims,
          this.notices,
          this.outbox,
          this.events,
          this.users,
          this.reasons,
          this.animals,
          this.controls,
        ].some((m) => m.db !== connection)
      )
        throw new ServiceUnavailableException(
          'Transfer request storage is not bound to the application database',
        );
      const expected = TRANSFER_REQUEST_MODELS.map(
        (m) => m.schema.get('collection') as string,
      );
      const hello = (await connection.db
        .admin()
        .command(
          { hello: 1 },
          { readPreference: 'primary', timeoutMS: 5000 },
        )) as {
        setName?: unknown;
        isWritablePrimary?: unknown;
        logicalSessionTimeoutMinutes?: unknown;
        msg?: unknown;
      };
      if (
        typeof hello.setName !== 'string' ||
        !hello.setName ||
        hello.isWritablePrimary !== true ||
        typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
        !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
        hello.logicalSessionTimeoutMinutes <= 0 ||
        hello.msg !== undefined
      )
        throw new ServiceUnavailableException(
          'Transfer requests require a validated replica-set primary with sessions',
        );
      const collections = await connection.db
        .listCollections(
          { name: { $in: expected } },
          { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
        )
        .toArray();
      if (
        expected.some(
          (name) =>
            !collections.some(
              (c) =>
                c.name === name &&
                c.type === 'collection' &&
                c.options?.capped !== true &&
                !c.options?.timeseries,
            ),
        )
      )
        throw new ServiceUnavailableException(
          'Transfer request collections must be prepared before use',
        );
      session = await connection.startSession();
      const active = session;
      return await active.withTransaction(
        () =>
          work({
            session: active,
            find: (id) =>
              this.requests.findById(id).session(active).lean().exec(),
            profile: async (id) => {
              const user = await this.users
                .findOneAndUpdate(
                  { id },
                  { $inc: { transferRequestRevision: 1 } },
                  { session: active, new: true },
                )
                .select({ id: 1, name: 1, transferRequestRevision: 1 })
                .lean()
                .exec();
              if (
                user &&
                (!Number.isSafeInteger(user.transferRequestRevision) ||
                  user.transferRequestRevision! < 1)
              )
                throw new ConflictError(
                  'Transfer participant fence is inconsistent',
                );
              return user ? { id: user.id, name: user.name ?? '' } : null;
            },
            reason: async (code) => {
              const reason = await this.reasons
                .findOneAndUpdate(
                  { code, isActive: true },
                  { $inc: { transferRequestRevision: 1 } },
                  { session: active, new: true },
                )
                .select({ code: 1, name: 1, transferRequestRevision: 1 })
                .lean()
                .exec();
              if (
                reason &&
                (!Number.isSafeInteger(reason.transferRequestRevision) ||
                  reason.transferRequestRevision! < 1)
              )
                throw new ConflictError(
                  'Transfer reason fence is inconsistent',
                );
              return reason
                ? {
                    code: reason.code as AnimalTransferReasonCode,
                    name: reason.name,
                  }
                : null;
            },
            animals: (ids, actor) => this.fenceAnimals(ids, actor, active),
            save: (request, items) => this.save(request, items, active),
          }),
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority', wtimeoutMS: 10000 },
          maxCommitTimeMS: 5000,
          timeoutMS: 15000,
        },
      );
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpException)
        throw error;
      if ((error as { code?: number })?.code === 11000)
        throw new TransferRequestCollision();
      throw new ServiceUnavailableException(
        'Transfer request outcome could not be confirmed; retry with the same Idempotency-Key',
      );
    } finally {
      if (session) await session.endSession();
    }
  }
  private async fenceAnimals(
    ids: readonly string[],
    actor: string,
    session: ClientSession,
  ): Promise<RequestAnimal[]> {
    const rows = await this.animals
      .find({ id: { $in: ids } })
      .session(session)
      .select({ id: 1, name: 1, code: 1, ownerId: 1, isActive: 1 })
      .lean()
      .exec();
    const controls = await this.controls
      .find({ animalId: { $in: ids } })
      .session(session)
      .select({ animalId: 1, ownerId: 1, ownershipVersion: 1 })
      .lean()
      .exec();
    const byId = new Map(rows.map((a) => [a.id, a])),
      byControl = new Map(controls.map((c) => [c.animalId, c]));
    if (rows.length !== ids.length || byId.size !== ids.length)
      throw new ResourceNotFoundError(
        'Selected animal set was not found or is inconsistent',
      );
    if (controls.length !== ids.length || byControl.size !== ids.length)
      throw new ConflictError(
        'Animal ownership control is inconsistent; repair it before requesting transfer',
      );
    const result: RequestAnimal[] = ids.map((id) => {
      const a = byId.get(id)!,
        c = byControl.get(id)!;
      if (a.ownerId !== actor)
        throw new ForbiddenError(
          'Selected animal does not belong to the sender',
        );
      if (a.isActive !== true && a.isActive != null)
        throw new ConflictError(
          'Only active animals can be requested for transfer',
        );
      if (
        c.ownerId !== actor ||
        !Number.isSafeInteger(c.ownershipVersion) ||
        c.ownershipVersion < 1
      )
        throw new ConflictError(
          'Animal ownership control is inconsistent; repair it before requesting transfer',
        );
      return {
        animalId: id,
        animalName: a.name,
        animalCode: a.code,
        expectedOwnershipVersion: c.ownershipVersion,
      };
    });
    // Snapshot reads alone are not authorization: force writes on the actual sources.
    const animalsWritten = await this.animals.bulkWrite(
      result.map((a) => ({
        updateOne: {
          filter: {
            id: a.animalId,
            ownerId: actor,
            $or: [
              { isActive: true },
              { isActive: { $type: 'null' } },
              { isActive: { $exists: false } },
            ],
          },
          update: { $inc: { transferRequestRevision: 1 } },
        },
      })),
      { session, ordered: true },
    );
    const controlsWritten = await this.controls.bulkWrite(
      result.map((a) => ({
        updateOne: {
          filter: {
            animalId: a.animalId,
            ownerId: actor,
            ownershipVersion: a.expectedOwnershipVersion,
          },
          update: { $inc: { transferRequestRevision: 1 } },
        },
      })),
      { session, ordered: true },
    );
    if (
      animalsWritten.matchedCount !== ids.length ||
      controlsWritten.matchedCount !== ids.length ||
      animalsWritten.modifiedCount !== ids.length ||
      controlsWritten.modifiedCount !== ids.length
    )
      throw new ConflictError(
        'Animal eligibility or ownership changed while creating the request',
      );
    return result;
  }
  private async save(
    request: TransferRequestRecord,
    items: TransferRequestItem[],
    session: ClientSession,
  ): Promise<void> {
    const options = { session };
    await this.requests.create([request], options);
    await this.itemRows.insertMany(items, { ...options, ordered: true });
    // Request exclusivity is separate from control.transferLock and activeWrites.
    await this.claims.insertMany(
      items.map((i) => ({ _id: i.animalId, transferId: request._id })),
      { ...options, ordered: true },
    );
    const notices: TransferNotice[] = (
      [
        ['TRANSFER_REQUEST_SENT', request.senderId, 'Solicitud enviada'],
        [
          'TRANSFER_REQUEST_RECEIVED',
          request.recipientId,
          'Solicitud recibida',
        ],
      ] as const
    ).map(([type, userId, title]) => ({
      _id: transferRecordId('notice', request._id, userId),
      userId,
      transferId: request._id,
      type,
      itemIds: items.map((i) => i._id),
      title,
      text: `La solicitud incluye ${items.length} animal(es).`,
      createdAt: request.createdAt,
    }));
    await this.notices.insertMany(notices, { ...options, ordered: true });
    await this.outbox.insertMany(
      notices.map((n) => ({
        _id: transferRecordId('outbox', request._id, n.userId),
        notificationId: n._id,
        userId: n.userId,
        transferId: request._id,
        status: 'PENDING',
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
        attempts: 0,
        createdAt: request.createdAt,
      })),
      { ...options, ordered: true },
    );
    await this.events.create(
      [
        {
          _id: transferRecordId('created', request._id),
          transferId: request._id,
          actorId: request.senderId,
          type: 'REQUEST_CREATED',
          createdAt: request.createdAt,
        },
      ],
      options,
    );
  }
  find(id: string) {
    return this.requests
      .findById(id)
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(5000)
      .lean()
      .exec();
  }
  list(
    actorId: string,
    direction: 'INCOMING' | 'OUTGOING',
    limit: number,
    after?: RequestListAfter,
  ) {
    return this.requests
      .find({
        [direction === 'INCOMING' ? 'recipientId' : 'senderId']: actorId,
        ...(after
          ? {
              $or: [
                { createdAt: { $lt: after.at } },
                { createdAt: after.at, _id: { $lt: after.id } },
              ],
            }
          : {}),
      })
      .read('primary')
      .readConcern('majority')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .maxTimeMS(5000)
      .lean()
      .exec();
  }
  items(transferId: string, limit: number, afterAnimalId?: string) {
    return this.itemRows
      .find({
        transferId,
        ...(afterAnimalId ? { animalId: { $gt: afterAnimalId } } : {}),
      })
      .read('primary')
      .readConcern('majority')
      .sort({ animalId: 1 })
      .limit(limit)
      .maxTimeMS(5000)
      .lean()
      .exec();
  }
}
