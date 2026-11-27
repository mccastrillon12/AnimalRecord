import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  FilterQuery,
  Model,
  mongo,
  STATES,
} from 'mongoose';
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
  assertTransferDecisionOpen,
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

type AcceptancePhase =
  | 'CONNECTION'
  | 'TOPOLOGY'
  | 'COLLECTIONS'
  | 'INDEXES'
  | 'SESSION'
  | 'TRANSACTION_START'
  | 'TRANSACTION_WORK'
  | 'TRANSACTION_CONFIRMATION'
  | 'SESSION_END';

/** Seven source collections, one read-only transaction; never adopts a lock/archive. */
@Injectable()
export class MongoTransferAcceptancePreparation implements AcceptancePreparationStore {
  private readonly logger = new Logger(MongoTransferAcceptancePreparation.name);

  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL)
    protected readonly requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL)
    protected readonly items: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    protected readonly claims: Model<RequestClaim>,
    @InjectModel(AnimalEntity.name)
    protected readonly animals: Model<AnimalEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    protected readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    protected readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(MedicalDocumentEntity.name)
    protected readonly medical: Model<MedicalDocumentEntity>,
  ) {}
  async snapshot<T>(
    raw: AcceptanceSelection,
    work: (snapshot: AcceptanceSnapshot) => T,
  ): Promise<T> {
    return this.visit(raw, (snapshot) => Promise.resolve(work(snapshot)));
  }
  protected get additionalModels(): readonly { db: Connection }[] {
    return [];
  }
  protected get additionalCollections(): readonly string[] {
    return [];
  }
  protected unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'Acceptance preparation snapshot could not be verified; no decision or reservation was authorized',
    );
  }
  protected validateAdditionalSources?(
    checking: (collection: string) => void,
  ): Promise<void>;

  private logUnavailable(
    phase: AcceptancePhase,
    error: unknown,
    collection?: string,
  ): void {
    const mongoError = error instanceof mongo.MongoError ? error : undefined;
    const code = mongoError?.code;
    this.logger.warn({
      event: 'transfer-acceptance-start-unconfirmed',
      phase,
      ...(collection && { collection }),
      ...(typeof code === 'number' && Number.isSafeInteger(code)
        ? { mongoCode: code }
        : {}),
      unknownCommitResult:
        mongoError?.hasErrorLabel('UnknownTransactionCommitResult') ?? false,
      transientTransaction:
        mongoError?.hasErrorLabel('TransientTransactionError') ?? false,
    });
  }
  /** Mongo-only callback. Any writes must use this same session; never dispatch I/O. */
  protected async visit<T>(
    raw: AcceptanceSelection,
    work: (
      snapshot: AcceptanceSnapshot,
      session: ClientSession,
      input: AcceptanceSelection,
    ) => Promise<T>,
    beforeSnapshot?: (
      request: TransferRequestRecord | null,
      session: ClientSession,
      input: AcceptanceSelection,
    ) => Promise<{ result: T } | undefined>,
  ): Promise<T> {
    const input = acceptanceSelection(raw);
    let session: ClientSession | undefined;
    let result!: T;
    let failure: Error | undefined;
    let phase: AcceptancePhase = 'CONNECTION';
    let collection: string | undefined;
    const unavailable = () => this.unavailable();
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
          ...this.additionalModels,
        ].some((m) => m.db !== connection)
      )
        throw unavailable();
      phase = 'TOPOLOGY';
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
      phase = 'COLLECTIONS';
      const names = [
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animals',
        'animal_ownership_controls',
        'animal_ownership_periods',
        'medical_documents',
        ...this.additionalCollections,
      ];
      // Some Atlas proxies reject compound collection-name filters.
      const listed = await db
        .listCollections(
          {},
          { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
        )
        .toArray();
      collection = names.find(
        (name) =>
          !listed.some(
            (c) =>
              c.name === name &&
              c.type === 'collection' &&
              c.options?.capped !== true &&
              !c.options?.timeseries,
          ),
      );
      if (collection) throw unavailable();
      phase = 'INDEXES';
      await this.validateAdditionalSources?.((name) => {
        collection = name;
      });
      collection = undefined;
      phase = 'SESSION';
      session = await connection.startSession();
      const active = session;
      phase = 'TRANSACTION_START';
      result = await active.withTransaction(
        async () => {
          phase = 'TRANSACTION_WORK';
          const request = await this.requests
            .findById(input.transferId)
            .select({
              _id: 1,
              senderId: 1,
              recipientId: 1,
              status: 1,
              expiresAt: 1,
              version: 1,
              animalCount: 1,
              decidedAt: 1,
              decisionOperationId: 1,
              decisionExpectedVersion: 1,
              acceptanceStart: 1,
              rejectionReasonCode: 1,
              rejectionComment: 1,
              acceptedItemCount: 1,
            })
            .session(active)
            .lean()
            .exec();
          const previous = await beforeSnapshot?.(request, active, input);
          if (previous) {
            phase = 'TRANSACTION_CONFIRMATION';
            return previous.result;
          }
          assertAcceptanceRequest(request, input); // Authorize before loading any associated sources.
          assertTransferDecisionOpen(request, new Date().toISOString());
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
                captureArchiveId: 1,
                captureReservationEpoch: 1,
              })
              .collation({ locale: 'simple' })
              .sort({ animalId: 1 })
              .limit(100)
              .setOptions({ singleBatch: true })
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
            if (!page.length) break;
            after = previous;
          }
          const claims = await this.readRows(
            this.claims,
            { transferId: input.transferId },
            '_id',
            { _id: 1, transferId: 1, acceptanceOperationId: 1 },
            active,
          );
          if (
            input.acceptedAnimalIds.some(
              (id) => !items.some((i) => i.animalId === id),
            )
          )
            throw new ConflictError(
              'Acceptance selection is outside the persisted request',
            );
          const animals = await this.readRows(
            this.animals,
            { id: { $in: input.acceptedAnimalIds } },
            'id',
            { _id: 0, id: 1, ownerId: 1, isActive: 1 },
            active,
          );
          const controls = await this.readRows(
            this.controls,
            { animalId: { $in: input.acceptedAnimalIds } },
            'animalId',
            {
              _id: 0,
              animalId: 1,
              ownerId: 1,
              ownershipVersion: 1,
              reservationEpoch: 1,
              transferLock: 1,
              activeWrites: 1,
              uploadsValidUntil: 1,
            },
            active,
          );
          const periods = await this.readRows(
            this.periods,
            { animalId: { $in: input.acceptedAnimalIds } },
            'id',
            {
              _id: 0,
              id: 1,
              animalId: 1,
              ownerId: 1,
              ownershipVersion: 1,
              status: 1,
              archiveId: 1,
            },
            active,
          );
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
          const outcome = await work(
            {
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
            },
            active,
            input,
          );
          phase = 'TRANSACTION_CONFIRMATION';
          return outcome;
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
      if (
        !(error instanceof DomainError) &&
        (!(error instanceof HttpException) || error.getStatus() === 503)
      )
        this.logUnavailable(phase, error, collection);
      failure =
        error instanceof DomainError || error instanceof HttpException
          ? error
          : unavailable();
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (error: unknown) {
          if (!failure) this.logUnavailable('SESSION_END', error);
          failure ??= unavailable();
        }
      }
    }
    if (failure !== undefined) throw failure;
    return result;
  }

  /** Single-batch keyset reads avoid driver 6.20 getMore + transaction CSOT.
   * A short batch can reflect the wire byte limit, so only an EMPTY page ends
   * the scan. The original snapshot/session and 15s transaction bound remain.
   * These keys are the existing stable unique identities, never page offsets.
   */
  private async readRows<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    key: keyof T & string,
    projection: Record<string, number>,
    session: ClientSession,
  ): Promise<T[]> {
    const rows: T[] = [];
    let after: string | undefined;
    while (true) {
      const page = await model
        .find(
          (after
            ? { $and: [filter, { [key]: { $gt: after } }] }
            : filter) as FilterQuery<T>,
        )
        .select(projection)
        .collation({ locale: 'simple' })
        .sort({ [key]: 1 })
        .limit(100)
        .setOptions({ singleBatch: true })
        .session(session)
        .lean()
        .exec();
      if (!page.length) return rows;
      let previous = after ?? '';
      for (const raw of page) {
        const row = raw as T,
          identity = row[key];
        if (typeof identity !== 'string' || identity <= previous)
          throw new ConflictError('Acceptance source page is inconsistent');
        previous = identity;
        rows.push(row);
      }
      after = previous;
    }
  }
}
