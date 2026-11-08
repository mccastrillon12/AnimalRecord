import { mongo } from 'mongoose';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../../domain/ownership-archive';
import {
  ItemSourceOperationalAccreditation,
  ItemSourceProfileReader,
  ItemSourceProfileRecord,
  ItemSourceProfileReference,
  captureItemSourceProfileRecord,
  captureItemSourceProfileReference,
  captureItemSourceOperationalAccreditation,
  matchActiveItemSourceProfile,
  matchItemSourceOperationalAccreditation,
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
  fenceRevision?: number;
}>;
type ProfileRow = Row &
  Readonly<{
    row: 'PROFILE';
    profile: ItemSourceProfileRecord;
    accreditation?: ItemSourceOperationalAccreditation;
  }>;
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
const profileTransaction = {
  readConcern: { level: 'snapshot' },
  readPreference: 'primary',
  writeConcern: { w: 'majority' },
  timeoutMS: 15000,
} as const;

function activeProfileFilter(ref: ItemSourceProfileReference) {
  return {
    row: 'PROFILE' as const,
    'profile.id': ref.id,
    'profile.revision': ref.revision,
    'profile.definitionHash': ref.definitionHash,
    'profile.state': 'ACTIVE',
  };
}

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
      session.withTransaction(async () => {
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
      }, profileTransaction),
    );
  }

  /** A trusted issuer supplies the evidence. This method records it without extending access. */
  async provisionSourceAccreditation(
    expected: ItemSourceProfileReference,
    raw: ItemSourceOperationalAccreditation,
  ) {
    const ref = captureItemSourceProfileReference(expected);
    const accreditation = captureItemSourceOperationalAccreditation(raw);
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        const { row, profile, shared } = await this.activeProfileRows(
          ref,
          session,
        );
        const observed = matchItemSourceOperationalAccreditation(
          accreditation,
          profile,
        );
        if (row.accreditation !== undefined) {
          const existing = matchItemSourceOperationalAccreditation(
            row.accreditation,
            profile,
          );
          if (archiveHash(existing) !== archiveHash(observed)) throw conflict();
          return Object.freeze({ accreditation: existing, replayed: true });
        }
        const result = await this.rows.updateOne(
          {
            _id: row._id,
            protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
            ...activeProfileFilter(ref),
            invalidation: { $exists: false },
            accreditation: { $exists: false },
          },
          { $set: { accreditation: observed } },
          { session, upsert: false },
        );
        if (
          !result.acknowledged ||
          result.matchedCount !== 1 ||
          result.modifiedCount !== 1
        )
          throw conflict();
        await this.fenceSharedControls(shared, session);
        return Object.freeze({ accreditation: observed, replayed: false });
      }, profileTransaction),
    );
  }

  /** Observational read. The future consumer must still fence the profile and controls. */
  async readActiveSourceAccreditation(
    expected: ItemSourceProfileReference,
    session?: mongo.ClientSession,
  ) {
    const ref = captureItemSourceProfileReference(expected);
    const read = async (active: mongo.ClientSession) => {
      const { row, profile } = await this.activeProfileRows(ref, active);
      if (row.accreditation === undefined) return null;
      return Object.freeze({
        profile,
        accreditation: matchItemSourceOperationalAccreditation(
          row.accreditation,
          profile,
        ),
      });
    };
    if (session) {
      this.assertProfileSession(session);
      return read(session);
    }
    return this.db.client.withSession((active) =>
      active.withTransaction(() => read(active), profileTransaction),
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
      activeProfileFilter(ref),
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

  /** The caller must propagate failure and revalidate the reservation in this transaction. */
  async fenceActiveSourceProfile(
    expected: ItemSourceProfileReference,
    session: mongo.ClientSession,
    validate?: (profile: ItemSourceProfileRecord) => void,
  ): Promise<void> {
    const ref = captureItemSourceProfileReference(expected);
    this.assertProfileSession(session);
    const { row, profile, shared } = await this.activeProfileRows(ref, session);
    validate?.(profile);

    await this.writeFence(row, activeProfileFilter(ref), session);
    await this.fenceSharedControls(shared, session);
  }

  private assertProfileSession(session: mongo.ClientSession) {
    const options = session?.transaction?.options;
    if (
      !session ||
      session.hasEnded ||
      !session.inTransaction() ||
      // The native driver exposes the owning client at runtime.
      (session as unknown as { client?: unknown }).client !== this.db.client ||
      (typeof options?.readConcern === 'string'
        ? options.readConcern
        : options?.readConcern?.level) !== 'snapshot' ||
      options?.writeConcern?.w !== 'majority' ||
      (typeof options?.readPreference === 'string'
        ? options.readPreference
        : options?.readPreference?.mode) !== 'primary'
    )
      throw conflict();
  }

  private async activeProfileRows(
    ref: ItemSourceProfileReference,
    session: mongo.ClientSession,
  ) {
    const row = await this.rows.findOne({ _id: ref.id }, { session });
    if (!row || row.row !== 'PROFILE') throw conflict();
    const profile = matchActiveItemSourceProfile(
      this.profile(row, ref.id),
      ref,
    );
    const controls = await this.rows.findOne(
      { _id: profile.controlsHash },
      { session },
    );
    if (!controls) throw conflict();
    const shared = this.controls(controls, profile.controlsHash);
    if (shared.state !== 'ACTIVE') throw conflict();
    return { row, profile, shared };
  }

  private fenceSharedControls(
    shared: ControlsRow,
    session: mongo.ClientSession,
  ) {
    return this.writeFence(
      shared,
      {
        row: 'CONTROLS',
        generationId: shared.generationId,
        configurationHash: shared.configurationHash,
        state: 'ACTIVE',
      },
      session,
    );
  }

  private async writeFence(
    row: ItemSourceProfileStateRow,
    active: mongo.Filter<ItemSourceProfileStateRow>,
    session: mongo.ClientSession,
  ): Promise<void> {
    const revision = row.fenceRevision;
    if (
      revision !== undefined &&
      (!Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision >= Number.MAX_SAFE_INTEGER)
    )
      throw conflict();
    // Preserve native error labels for the caller's transaction retry/abort.
    const result = await this.rows.updateOne(
      {
        _id: row._id,
        protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
        ...active,
        invalidation: { $exists: false },
        fenceRevision: revision ?? { $exists: false },
      },
      { $inc: { fenceRevision: 1 } },
      { session, upsert: false },
    );
    if (
      !result.acknowledged ||
      result.matchedCount !== 1 ||
      result.modifiedCount !== 1
    )
      throw conflict();
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
