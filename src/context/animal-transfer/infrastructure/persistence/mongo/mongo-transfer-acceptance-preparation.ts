import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, STATES } from 'mongoose';
import { validate as isUuid } from 'uuid';
import {
  AcceptancePreparationStore,
  AcceptanceSelection,
  AcceptanceSnapshot,
  AcceptanceItem,
  assertAcceptanceRequest,
  acceptanceSelection,
} from '../../../domain/transfer-acceptance-preparation';
import {
  TransferRequestRecord,
  TransferRequestItem,
} from '../../../domain/transfer-request';
import {
  RequestClaim,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
} from './transfer-request.schema';
import { AnimalEntity } from '../../../../animal/infrastructure/persistence/mongo/animal.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import { MedicalDocumentEntity } from '../../../../medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { MedicalDocumentStatus } from '../../../../medical-document/domain/medical-document';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';

/** Seven source collections, one read-only transaction; never adopts a lock/archive. */
@Injectable()
export class MongoTransferAcceptancePreparation implements AcceptancePreparationStore {
  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL)
    private readonly requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL)
    private readonly items: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    private readonly claims: Model<RequestClaim>,
    @InjectModel(AnimalEntity.name)
    private readonly animals: Model<AnimalEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(MedicalDocumentEntity.name)
    private readonly medical: Model<MedicalDocumentEntity>,
  ) {}
  async snapshot<T>(
    raw: AcceptanceSelection,
    work: (snapshot: AcceptanceSnapshot) => T,
  ): Promise<T> {
    const input = acceptanceSelection(raw);
    let session: ClientSession | undefined;
    let result!: T;
    let failure: Error | undefined;
    const unavailable = () =>
      new ServiceUnavailableException(
        'Acceptance preparation snapshot could not be verified; no decision or reservation was authorized',
      );
    try {
      const connection = this.requests.db,
        db = connection.db;
      if (
        !db ||
        connection.readyState !== STATES.connected ||
        [
          this.items,
          this.claims,
          this.animals,
          this.controls,
          this.periods,
          this.medical,
        ].some((m) => m.db !== connection)
      )
        throw unavailable();
      const hello = (await db
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
        throw unavailable();
      const names = [
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animals',
        'animal_ownership_controls',
        'animal_ownership_periods',
        'medical_documents',
      ];
      const listed = await db
        .listCollections(
          { name: { $in: names } },
          { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
        )
        .toArray();
      if (
        names.some(
          (name) =>
            !listed.some(
              (c) =>
                c.name === name &&
                c.type === 'collection' &&
                c.options?.capped !== true &&
                !c.options?.timeseries,
            ),
        )
      )
        throw unavailable();
      session = await connection.startSession();
      const active = session;
      result = await active.withTransaction(
        async () => {
          const request = await this.requests
            .findById(input.transferId)
            .select({
              _id: 1,
              senderId: 1,
              recipientId: 1,
              status: 1,
              version: 1,
              animalCount: 1,
              decidedAt: 1,
              decisionOperationId: 1,
              decisionExpectedVersion: 1,
            })
            .session(active)
            .lean()
            .exec();
          assertAcceptanceRequest(request, input); // Authorize before loading any associated sources.
          const items: AcceptanceItem[] = [];
          let after: string | undefined;
          while (true) {
            const page = await this.items
              .find({
                transferId: input.transferId,
                ...(after ? { animalId: { $gt: after } } : {}),
              })
              .select({
                _id: 1,
                transferId: 1,
                animalId: 1,
                expectedOwnerId: 1,
                expectedOwnershipVersion: 1,
                status: 1,
              })
              .collation({ locale: 'simple' })
              .sort({ animalId: 1 })
              .limit(100)
              .session(active)
              .lean()
              .exec();
            let previous = after ?? '';
            for (const item of page) {
              if (!isUuid(item.animalId) || item.animalId <= previous)
                throw new ConflictError('Acceptance item page is inconsistent');
              previous = item.animalId;
            }
            items.push(...page);
            if (items.length > request.animalCount)
              throw new ConflictError('Acceptance item count is inconsistent');
            if (page.length < 100) break;
            after = previous;
          }
          const claims = await this.claims
            .find({ transferId: input.transferId })
            .select({ _id: 1, transferId: 1 })
            .session(active)
            .lean()
            .exec();
          if (
            input.acceptedAnimalIds.some(
              (id) => !items.some((i) => i.animalId === id),
            )
          )
            throw new ConflictError(
              'Acceptance selection is outside the persisted request',
            );
          const animals = await this.animals
            .find({ id: { $in: input.acceptedAnimalIds } })
            .select({ _id: 0, id: 1, ownerId: 1, isActive: 1 })
            .session(active)
            .lean()
            .exec();
          const controls = await this.controls
            .find({ animalId: { $in: input.acceptedAnimalIds } })
            .select({
              _id: 0,
              animalId: 1,
              ownerId: 1,
              ownershipVersion: 1,
              reservationEpoch: 1,
              transferLock: 1,
              activeWrites: 1,
              uploadsValidUntil: 1,
            })
            .session(active)
            .lean()
            .exec();
          const periods = await this.periods
            .find({ animalId: { $in: input.acceptedAnimalIds } })
            .select({
              _id: 0,
              id: 1,
              animalId: 1,
              ownerId: 1,
              ownershipVersion: 1,
              status: 1,
            })
            .session(active)
            .lean()
            .exec();
          const pendingMedicalAnimalIds: string[] = [];
          for (const animalId of input.acceptedAnimalIds) {
            const pending = await this.medical
              .findOne({
                animalIds: animalId,
                status: {
                  $nin: [
                    MedicalDocumentStatus.Accepted,
                    MedicalDocumentStatus.Rejected,
                    MedicalDocumentStatus.Failed,
                  ],
                },
              })
              .select({ _id: 1 })
              .session(active)
              .lean()
              .exec();
            if (pending) pendingMedicalAnimalIds.push(animalId);
          }
          return work({
            request,
            items,
            claims,
            animals,
            periods,
            pendingMedicalAnimalIds,
            controls: controls.map((c) => {
              if (
                c.activeWrites !== undefined &&
                !Array.isArray(c.activeWrites)
              )
                throw new ConflictError(
                  'Acceptance writer state is inconsistent',
                );
              return {
                animalId: c.animalId,
                ownerId: c.ownerId,
                ownershipVersion: c.ownershipVersion,
                ...(c.reservationEpoch !== undefined
                  ? { reservationEpoch: c.reservationEpoch }
                  : {}),
                lockPresent: c.transferLock !== undefined,
                writersPresent: !!c.activeWrites?.length,
                ...(c.uploadsValidUntil !== undefined
                  ? { uploadsValidUntil: c.uploadsValidUntil }
                  : {}),
              };
            }),
          });
        },
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority', wtimeoutMS: 10000 },
          timeoutMS: 15000,
          maxCommitTimeMS: 5000,
        },
      );
    } catch (error) {
      failure =
        error instanceof DomainError || error instanceof HttpException
          ? error
          : unavailable();
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch {
          failure ??= unavailable();
        }
      }
    }
    if (failure !== undefined) throw failure;
    return result;
  }
}
