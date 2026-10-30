import {
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, STATES } from 'mongoose';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import {
  ItemCaptureAdmission,
  ItemCaptureInput,
  ItemCaptureProgress,
  ItemCaptureStore,
  assessItemCapture,
  itemCaptureInput,
  nextItemCaptureFence,
  selectItemCapture,
} from '../../../domain/transfer-item-capture';
import {
  TransferRequestItem,
  TransferRequestRecord,
} from '../../../domain/transfer-request';
import {
  OwnershipArchive,
  archiveHash,
} from '../../../domain/ownership-archive';
import {
  RequestClaim,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
} from './transfer-request.schema';
import { OWNERSHIP_ARCHIVE_MODEL } from './ownership-archive.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import { fenceArchiveReservation } from './archive-reservation-fence';

@Injectable()
export class MongoTransferItemCapture implements ItemCaptureStore {
  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL)
    private readonly requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL)
    private readonly items: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    private readonly claims: Model<RequestClaim>,
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
  ) {}
  admit(raw: ItemCaptureInput): Promise<ItemCaptureAdmission> {
    return this.transaction(itemCaptureInput(raw), true);
  }
  async observe(raw: ItemCaptureInput): Promise<ItemCaptureProgress> {
    const result = await this.transaction(itemCaptureInput(raw), false);
    if (!('progress' in result)) throw this.unavailable();
    return result.progress;
  }
  private unavailable() {
    return new ServiceUnavailableException(
      'Item capture admission or progress could not be acknowledged; retain the original reservation and reobserve the same revision',
    );
  }
  private async transaction(
    input: ItemCaptureInput,
    admit: boolean,
  ): Promise<ItemCaptureAdmission> {
    let session: ClientSession | undefined,
      failure: Error | undefined,
      result!: ItemCaptureAdmission;
    try {
      const connection = this.requests.db,
        db = connection.db;
      const models = [
        this.items,
        this.claims,
        this.archives,
        this.controls,
        this.periods,
      ];
      if (
        !db ||
        connection.readyState !== STATES.connected ||
        models.some((m) => m.db !== connection)
      )
        throw this.unavailable();
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
        hello.msg !== undefined ||
        typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
        !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
        hello.logicalSessionTimeoutMinutes <= 0
      )
        throw this.unavailable();
      const names = [
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_archives',
        'animal_ownership_controls',
        'animal_ownership_periods',
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
        throw this.unavailable();
      const required: Array<{
        name: string;
        key: Record<string, number>;
        partial?: Record<string, string>;
      }> = [
        { name: 'animal_ownership_controls', key: { animalId: 1 } },
        { name: 'animal_ownership_periods', key: { id: 1 } },
        {
          name: 'animal_ownership_periods',
          key: { animalId: 1 },
          partial: { status: 'ACTIVE' },
        },
        { name: 'animal_ownership_archives', key: { id: 1 } },
      ];
      for (const name of names) {
        const indexes = (await db
          .collection(name)
          .listIndexes({
            readPreference: 'primary',
            maxTimeMS: 5000,
            timeoutMS: 5000,
          })
          .toArray()) as Array<{
          key: unknown;
          unique?: unknown;
          sparse?: unknown;
          hidden?: unknown;
          buildUUID?: unknown;
          partialFilterExpression?: unknown;
          expireAfterSeconds?: unknown;
          collation?: { locale?: unknown };
        }>;
        if (
          indexes.some((i) => i.expireAfterSeconds !== undefined) ||
          required
            .filter((r) => r.name === name)
            .some(
              (r) =>
                !indexes.some(
                  (i) =>
                    JSON.stringify(i.key) === JSON.stringify(r.key) &&
                    i.unique === true &&
                    i.sparse !== true &&
                    i.hidden !== true &&
                    i.buildUUID === undefined &&
                    archiveHash(i.partialFilterExpression) ===
                      archiveHash(r.partial) &&
                    (!i.collation || i.collation.locale === 'simple'),
                ),
            )
        )
          throw this.unavailable();
      }
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
              acceptanceStart: 1,
              captureStepRevision: 1,
            })
            .session(active)
            .lean()
            .exec();
          const { selected } = selectItemCapture(input, request); // Authorize before associated reads.
          const item = await this.items
            .findById(selected.itemId)
            .select({
              _id: 1,
              transferId: 1,
              animalId: 1,
              expectedOwnerId: 1,
              expectedOwnershipVersion: 1,
              status: 1,
              captureArchiveId: 1,
              captureReservationEpoch: 1,
              captureStepRevision: 1,
            })
            .session(active)
            .lean()
            .exec();
          const claim = await this.claims
            .findById(selected.animalId)
            .select({
              _id: 1,
              transferId: 1,
              acceptanceOperationId: 1,
              captureStepRevision: 1,
            })
            .session(active)
            .lean()
            .exec();
          const archive = await this.archives
            .findOne({ id: selected.archiveId })
            .select({
              _id: 0,
              id: 1,
              animalId: 1,
              ownerId: 1,
              recipientId: 1,
              periodId: 1,
              transferId: 1,
              ownershipVersion: 1,
              definitionHash: 1,
              reservation: 1,
              evidenceConsumption: 1,
              state: 1,
              capture: 1,
              createdAt: 1,
            })
            .session(active)
            .lean()
            .exec();
          const control = await this.controls
            .findOne({ animalId: selected.animalId })
            .select({
              _id: 0,
              animalId: 1,
              ownerId: 1,
              ownershipVersion: 1,
              reservationEpoch: 1,
              transferLock: 1,
              activeWrites: 1,
            })
            .session(active)
            .lean()
            .exec();
          const assessment = assessItemCapture(input, {
            request,
            item,
            claim,
            archive,
            control,
          });
          if (
            !(await this.periods
              .exists({
                id: archive!.periodId,
                animalId: archive!.animalId,
                ownerId: archive!.ownerId,
                ownershipVersion: 1,
                status: 'ACTIVE',
              })
              .session(active)
              .exec()) ||
            (await this.periods
              .exists({ animalId: archive!.animalId, status: 'CLOSED' })
              .session(active)
              .exec())
          )
            throw new ConflictError(
              'Item capture still requires its initial active period',
            );
          if (!admit || !assessment.needsWork)
            return { progress: assessment.progress };
          const revisions = [
            request!.captureStepRevision,
            item!.captureStepRevision,
            claim!.captureStepRevision,
          ];
          const next = revisions.map(nextItemCaptureFence);
          const written = await this.requests
            .updateOne(
              {
                _id: input.transferId,
                status: 'PROCESSING',
                version: input.expectedRequestVersion,
                recipientId: input.actorId,
                decisionOperationId: input.decisionOperationId,
                'acceptanceStart.bindingHash':
                  request!.acceptanceStart!.bindingHash,
                captureStepRevision: revisions[0] ?? { $exists: false },
              },
              { $set: { captureStepRevision: next[0] } },
              { session: active },
            )
            .exec();
          this.changed(written);
          this.changed(
            await this.items
              .updateOne(
                {
                  _id: input.itemId,
                  transferId: input.transferId,
                  status: 'PROCESSING',
                  captureArchiveId: selected.archiveId,
                  captureReservationEpoch: selected.reservationEpoch,
                  captureStepRevision: revisions[1] ?? { $exists: false },
                },
                { $set: { captureStepRevision: next[1] } },
                { session: active },
              )
              .exec(),
          );
          this.changed(
            await this.claims
              .updateOne(
                {
                  _id: selected.animalId,
                  transferId: input.transferId,
                  acceptanceOperationId: input.decisionOperationId,
                  captureStepRevision: revisions[2] ?? { $exists: false },
                },
                { $set: { captureStepRevision: next[2] } },
                { session: active },
              )
              .exec(),
          );
          await fenceArchiveReservation(
            archive!,
            this.controls,
            this.periods,
            active,
          );
          return { scope: assessment.scope };
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
          : this.unavailable();
    } finally {
      try {
        await session?.endSession();
      } catch {
        failure ??= this.unavailable();
      }
    }
    if (failure) throw failure;
    return result;
  }
  private changed(result: { matchedCount: number; modifiedCount: number }) {
    if (result.matchedCount !== 1 || result.modifiedCount !== 1)
      throw new ConflictError('The item capture admission fence changed');
  }
}
