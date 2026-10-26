import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import {
  ANIMAL_WRITE_KINDS,
  ANIMAL_WRITE_PROTOCOL,
  AnimalWriteJournal,
  AnimalWriteJournalRepository,
  WriteCallbackOutcome,
  WriteClaimState,
  WriteJournalHandle,
} from '../../../domain/animal-write-journal';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';

export const ANIMAL_WRITE_JOURNAL_MODEL = 'AnimalWriteJournal';
const CLAIM_STATES = [
  'NOT_ATTEMPTED',
  'INTENT',
  'ACQUIRED',
  'NOT_ACQUIRED',
  'ACQUIRE_UNKNOWN',
  'RELEASED',
  'RELEASE_UNKNOWN',
  'RECOVERED',
];
const RECOVERABLE_CLAIM_STATES = CLAIM_STATES.filter(
  (state) => state !== 'RECOVERED',
);
const AnimalWriteRecoveryClaimSchema = new Schema(
  {
    animalId: { type: String, required: true },
    previousState: {
      type: String,
      enum: RECOVERABLE_CLAIM_STATES,
      required: true,
    },
    tokenRemoved: { type: Boolean, required: true },
  },
  { _id: false },
);
const AnimalWriteRecoveryAuditSchema = new Schema(
  {
    requestId: { type: String, required: true },
    operatorId: { type: String, required: true },
    reason: {
      type: String,
      enum: ['INSTANCE_TERMINATION_CONFIRMED', 'OPERATOR_INTERVENTION'],
      required: true,
    },
    evidenceRef: { type: String, required: true },
    recoveredAt: { type: String, required: true },
    claims: { type: [AnimalWriteRecoveryClaimSchema], required: true },
  },
  { _id: false },
);
export const AnimalWriteJournalSchema = new Schema<AnimalWriteJournal>(
  {
    id: { type: String, unique: true, required: true },
    instanceId: { type: String, required: true },
    protocol: { type: String, enum: [ANIMAL_WRITE_PROTOCOL] },
    instanceStartedAt: { type: String, required: true },
    actorId: { type: String, required: true },
    kind: { type: String, enum: ANIMAL_WRITE_KINDS, required: true },
    issuesUploadUrl: { type: Boolean, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    lifecycle: {
      type: String,
      enum: ['OPEN', 'LOCALLY_FINISHED', 'RECOVERED_BEFORE_CALLBACK'],
      required: true,
    },
    callback: {
      type: String,
      enum: ['NOT_STARTED', 'MAY_RUN', 'RETURNED', 'THREW', 'NOT_INVOKED'],
      required: true,
    },
    callbackPermittedAt: String,
    callbackSettledAt: String,
    coordinatorOutcome: { type: String, enum: ['RETURNED', 'THREW'] },
    coordinatorSettledAt: String,
    recovery: { type: AnimalWriteRecoveryAuditSchema },
    claims: {
      type: [
        new Schema(
          {
            animalId: { type: String, required: true },
            state: { type: String, enum: CLAIM_STATES, required: true },
            updatedAt: { type: String, required: true },
            ownershipVersion: { type: Number, min: 1 },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
  },
  { collection: 'animal_write_journals' },
);
AnimalWriteJournalSchema.index({ instanceId: 1, lifecycle: 1 });
const MAJORITY = { writeConcern: { w: 'majority' as const } };
const SETTLED = ['RETURNED', 'THREW', 'NOT_INVOKED'];

@Injectable()
export class MongoAnimalWriteJournal implements AnimalWriteJournalRepository {
  constructor(
    @InjectModel(ANIMAL_WRITE_JOURNAL_MODEL)
    private readonly journals: Model<AnimalWriteJournal>,
  ) {}

  async create(journal: AnimalWriteJournal): Promise<void> {
    if (
      journal.lifecycle !== 'OPEN' ||
      journal.protocol !== ANIMAL_WRITE_PROTOCOL ||
      journal.callback !== 'NOT_STARTED' ||
      !journal.claims.length ||
      new Set(journal.claims.map((claim) => claim.animalId)).size !==
        journal.claims.length ||
      journal.claims.some((claim) => claim.state !== 'NOT_ATTEMPTED') ||
      journal.coordinatorOutcome !== undefined ||
      journal.callbackPermittedAt !== undefined ||
      journal.recovery !== undefined
    )
      throw new ConflictError('Invalid initial animal write journal');
    try {
      await this.journals.create([journal], { w: 'majority' });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000)
        throw new ConflictError(
          'The animal write journal ID has already been used',
        );
      throw error;
    }
  }
  async find(id: string): Promise<AnimalWriteJournal | null> {
    return this.journals
      .findOne({ id })
      .select({ _id: 0, __v: 0 })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async claim(
    handle: WriteJournalHandle,
    animalId: string,
    state: Exclude<WriteClaimState, 'NOT_ATTEMPTED' | 'RECOVERED'>,
    at: string,
    ownershipVersion?: number,
  ): Promise<void> {
    const previous: Record<
      Exclude<WriteClaimState, 'NOT_ATTEMPTED' | 'RECOVERED'>,
      WriteClaimState[]
    > = {
      INTENT: ['NOT_ATTEMPTED'],
      ACQUIRED: ['ACQUIRED'],
      NOT_ACQUIRED: ['INTENT'],
      ACQUIRE_UNKNOWN: ['INTENT'],
      RELEASED: ['INTENT', 'ACQUIRED'],
      RELEASE_UNKNOWN: ['INTENT', 'ACQUIRED'],
    };
    if (
      !previous[state] ||
      (state === 'INTENT' &&
        (!Number.isSafeInteger(ownershipVersion) || ownershipVersion! < 1))
    )
      throw new ConflictError('Invalid animal write journal claim transition');
    await this.update(
      {
        ...handle,
        lifecycle: 'OPEN',
        ...(state === 'INTENT' ? { callback: 'NOT_STARTED' } : {}),
        claims: { $elemMatch: { animalId, state: { $in: previous[state] } } },
      },
      {
        $set: {
          'claims.$.state': state,
          'claims.$.updatedAt': at,
          updatedAt: at,
          ...(state === 'INTENT'
            ? { 'claims.$.ownershipVersion': ownershipVersion }
            : {}),
        },
      },
    );
  }

  async permitCallback(handle: WriteJournalHandle, at: string): Promise<void> {
    await this.update(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: 'NOT_STARTED',
        protocol: ANIMAL_WRITE_PROTOCOL,
        callbackPermittedAt: { $exists: false },
        'claims.0': { $exists: true },
        claims: { $not: { $elemMatch: { state: { $ne: 'ACQUIRED' } } } },
      },
      { $set: { callback: 'MAY_RUN', callbackPermittedAt: at, updatedAt: at } },
    );
  }
  async settleCallback(
    handle: WriteJournalHandle,
    outcome: WriteCallbackOutcome,
    at: string,
  ): Promise<void> {
    await this.update(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: {
          $in:
            outcome === 'NOT_INVOKED'
              ? ['NOT_STARTED', 'MAY_RUN']
              : ['MAY_RUN'],
        },
      },
      { $set: { callback: outcome, callbackSettledAt: at, updatedAt: at } },
    );
  }
  async finish(
    handle: WriteJournalHandle,
    outcome: 'RETURNED' | 'THREW',
    at: string,
  ): Promise<void> {
    await this.update(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: { $in: SETTLED },
        coordinatorOutcome: { $exists: false },
      },
      {
        $set: {
          coordinatorOutcome: outcome,
          coordinatorSettledAt: at,
          updatedAt: at,
        },
      },
    );
    // Uncertain claims stay OPEN even after a local callback has settled.
    await this.journals
      .updateOne(
        {
          ...handle,
          lifecycle: 'OPEN',
          callback: { $in: SETTLED },
          coordinatorOutcome: outcome,
          claims: {
            $not: {
              $elemMatch: {
                state: { $nin: ['NOT_ATTEMPTED', 'NOT_ACQUIRED', 'RELEASED'] },
              },
            },
          },
        },
        { $set: { lifecycle: 'LOCALLY_FINISHED', updatedAt: at } },
        MAJORITY,
      )
      .exec();
  }
  private async update(filter: object, update: object): Promise<void> {
    const result = await this.journals
      .updateOne(filter, update, MAJORITY)
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictError(
        'The animal write journal changed; refresh before retrying',
      );
  }
}
