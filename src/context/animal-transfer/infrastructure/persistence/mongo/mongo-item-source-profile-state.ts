import { mongo } from 'mongoose';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../../domain/ownership-archive';
import {
  ItemSourceProfileReader,
  ItemSourceProfileRecord,
  ItemSourceProfileReference,
  captureItemSourceProfileRecord,
  captureItemSourceProfileReference,
  profileIdValid,
  sourceHashValid,
} from '../../../domain/transfer-item-historical-observation';

export const ITEM_SOURCE_PROFILE_STATE_COLLECTION =
  'animal_transfer_source_profile_states';
export const ITEM_SOURCE_PROFILE_STATE_PROTOCOL =
  'ITEM_SOURCE_PROFILE_STATE_V1' as const;

type Invalidation = Readonly<{ requestId: string; evidenceHash: string }>;
type State = 'ACTIVE' | 'INVALIDATED';
type Row = Readonly<{
  _id: string;
  protocol: typeof ITEM_SOURCE_PROFILE_STATE_PROTOCOL;
  invalidation?: Invalidation;
}>;
type ProfileRow = Row &
  Readonly<{ row: 'PROFILE'; profile: ItemSourceProfileRecord }>;
type ControlsRow = Row &
  Readonly<{
    row: 'CONTROLS';
    generationId: string;
    configurationHash: string;
    state: State;
  }>;
export type ItemSourceProfileStateRow = ProfileRow | ControlsRow;

const conflict = () =>
  new ConflictError(
    'The source profile or shared controls state changed or is invalid',
  );
const majorityRead = {
  readPreference: 'primary',
  readConcern: { level: 'majority' },
  timeoutMS: 15000,
} as const;

function captureInvalidation(raw: Invalidation): Invalidation {
  if (
    !raw ||
    Object.keys(raw).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(raw, 'requestId') ||
    !Object.prototype.hasOwnProperty.call(raw, 'evidenceHash') ||
    !profileIdValid(raw.requestId) ||
    !sourceHashValid(raw.evidenceHash)
  )
    throw conflict();
  return Object.freeze({
    requestId: raw.requestId,
    evidenceHash: raw.evidenceHash,
  });
}

function checkInvalidation(state: State, invalidation?: Invalidation) {
  if (state === 'INVALIDATED') {
    if (!invalidation) throw conflict();
    return captureInvalidation(invalidation);
  }
  if (state !== 'ACTIVE' || invalidation !== undefined) throw conflict();
  return undefined;
}

export function itemSourceControlsHash(
  generationId: string,
  configurationHash: string,
) {
  if (!profileIdValid(generationId) || !sourceHashValid(configurationHash))
    throw conflict();
  return archiveHash({
    protocol: 'ITEM_HISTORICAL_SOURCE_CONTROLS_V1',
    generationId,
    configurationHash,
  });
}

/** Explicit technical storage. Only an authorized issuer can provision active rows. */
export class MongoItemSourceProfileState implements ItemSourceProfileReader {
  private readonly rows: mongo.Collection<ItemSourceProfileStateRow>;

  constructor(private readonly db: mongo.Db) {
    this.rows = db.collection<ItemSourceProfileStateRow>(
      ITEM_SOURCE_PROFILE_STATE_COLLECTION,
    );
  }

  async readCurrentSourceProfile(
    id: string,
  ): Promise<ItemSourceProfileRecord | null> {
    if (!profileIdValid(id)) throw conflict();
    return this.db.client.withSession((session) =>
      session.withTransaction(
        async () => {
          const row = await this.rows.findOne({ _id: id }, { session });
          if (!row) return null;
          const profile = this.profile(row, id);
          if (profile.state === 'INVALIDATED') return profile;
          const controls = await this.rows.findOne(
            { _id: profile.controlsHash },
            { session },
          );
          if (!controls) return null;
          const shared = this.controls(controls, profile.controlsHash);
          return shared.state === 'ACTIVE'
            ? profile
            : Object.freeze({ ...profile, state: 'INVALIDATED' as const });
        },
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority' },
          timeoutMS: 15000,
        },
      ),
    );
  }

  async invalidateProfile(
    expected: ItemSourceProfileReference,
    invalidation: Invalidation,
  ) {
    const ref = captureItemSourceProfileReference(expected);
    return this.invalidate(
      ref.id,
      invalidation,
      (row) => {
        const profile = this.profile(row, ref.id);
        if (
          profile.revision !== ref.revision ||
          profile.definitionHash !== ref.definitionHash
        )
          throw conflict();
        return checkInvalidation(profile.state, row.invalidation);
      },
      {
        row: 'PROFILE',
        'profile.id': ref.id,
        'profile.revision': ref.revision,
        'profile.definitionHash': ref.definitionHash,
        'profile.state': 'ACTIVE',
      },
      'profile.state',
    );
  }

  async invalidateSharedControls(
    controlsHash: string,
    invalidation: Invalidation,
  ) {
    if (!sourceHashValid(controlsHash)) throw conflict();
    return this.invalidate(
      controlsHash,
      invalidation,
      (row) =>
        checkInvalidation(
          this.controls(row, controlsHash).state,
          row.invalidation,
        ),
      { row: 'CONTROLS', state: 'ACTIVE' },
      'state',
    );
  }

  private profile(
    row: ItemSourceProfileStateRow,
    id: string,
  ): ItemSourceProfileRecord {
    if (
      row.protocol !== ITEM_SOURCE_PROFILE_STATE_PROTOCOL ||
      row.row !== 'PROFILE' ||
      row._id !== id
    )
      throw conflict();
    const profile = captureItemSourceProfileRecord(row.profile);
    if (profile.id !== id) throw conflict();
    checkInvalidation(profile.state, row.invalidation);
    return profile;
  }

  private controls(
    row: ItemSourceProfileStateRow,
    controlsHash: string,
  ): ControlsRow {
    if (
      row.protocol !== ITEM_SOURCE_PROFILE_STATE_PROTOCOL ||
      row.row !== 'CONTROLS' ||
      row._id !== controlsHash ||
      itemSourceControlsHash(row.generationId, row.configurationHash) !==
        controlsHash
    )
      throw conflict();
    checkInvalidation(row.state, row.invalidation);
    return row;
  }

  private async invalidate(
    id: string,
    raw: Invalidation,
    storedInvalidation: (
      row: ItemSourceProfileStateRow,
    ) => Invalidation | undefined,
    active: mongo.Filter<ItemSourceProfileStateRow>,
    stateField: 'state' | 'profile.state',
  ) {
    const invalidation = captureInvalidation(raw);
    const read = async () => {
      const row = await this.rows.findOne({ _id: id }, majorityRead);
      if (!row) throw conflict();
      const stored = storedInvalidation(row);
      if (
        stored &&
        (stored.requestId !== invalidation.requestId ||
          stored.evidenceHash !== invalidation.evidenceHash)
      )
        throw conflict();
      return stored;
    };
    const receipt = (replayed: boolean) =>
      Object.freeze({
        id,
        requestId: invalidation.requestId,
        state: 'INVALIDATED' as const,
        replayed,
        copyDispatch: 'NOT_AUTHORIZED' as const,
        businessCommit: 'NOT_AUTHORIZED' as const,
      });
    try {
      if (await read()) return receipt(true);
      const result = await this.rows.updateOne(
        {
          _id: id,
          protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
          ...active,
          invalidation: { $exists: false },
        },
        { $set: { [stateField]: 'INVALIDATED', invalidation } },
        { upsert: false, writeConcern: { w: 'majority' }, timeoutMS: 15000 },
      );
      if (!result.acknowledged)
        throw new ExternalServiceError(
          'The source profile invalidation could not be acknowledged',
        );
      if (result.matchedCount === 1 && result.modifiedCount === 1)
        return receipt(false);
      if (
        result.matchedCount === 0 &&
        result.modifiedCount === 0 &&
        (await read())
      )
        return receipt(true);
      throw conflict();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'The source profile invalidation could not be acknowledged',
      );
    }
  }
}
