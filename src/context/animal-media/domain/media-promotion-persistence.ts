import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  MediaPromotionDefinition,
  MediaPromotionScope,
  promotionDefinition,
  promotionDefinitionHash,
  promotionEvidenceRef,
  promotionId,
} from './media-promotion-effect';
import {
  MediaPromotionCommand,
  MediaPromotionModel,
  PromotionAttempt,
  PromotionObservation,
  advanceMediaPromotion,
} from './media-promotion-machine';

export const MEDIA_PROMOTION_STORAGE_PROTOCOL =
  'MEDIA_PROMOTION_ROWS_V1' as const;
export type PromotionSelection = {
  operationId: string;
  instanceId: string;
  animalId: string;
};
export type PromotionAudit = {
  requestId: string;
  operatorId: string;
  evidenceRef: string;
};
type BaseRow = {
  id: string;
  identityIds: string[];
  operationId: string;
  protocol: typeof MEDIA_PROMOTION_STORAGE_PROTOCOL;
  gateRevision: number;
};
export type PromotionGateRow = BaseRow & {
  kind: 'GATE';
  data: {
    scope: MediaPromotionScope;
    effectCount: number;
    gate: { state: 'OPEN' } | ({ state: 'REVOKED' } & PromotionAudit);
  };
};
export type PromotionEffectRow = BaseRow & {
  kind: 'EFFECT';
  effectId: string;
  uploadId: string;
  bucket: string;
  destinationKey: string;
  data: {
    definition: MediaPromotionDefinition;
    definitionHash: string;
    attemptCount: number;
    lastAttemptId?: string;
  };
};
export type PromotionAttemptRow = BaseRow & {
  kind: 'ATTEMPT';
  effectId: string;
  ordinal: number;
  authorizationId?: string;
  data: Pick<
    PromotionAttempt,
    'dispatcherInstanceId' | 'origin' | 'previousAttemptId'
  >;
};
export type PromotionResponseRow = BaseRow & {
  kind: 'RESPONSE';
  effectId: string;
  attemptId: string;
  data: { outcome: 'UNKNOWN' | 'ACKNOWLEDGED'; evidenceRef: string };
};
export type PromotionObservationRow = BaseRow & {
  kind: 'OBSERVATION';
  effectId: string;
  data: Omit<PromotionObservation, 'id'> & {
    uploadId?: string;
    sha256?: string;
    revision?: { etag: string; size: number; versionId?: string };
  };
};
export type PromotionRow =
  | PromotionGateRow
  | PromotionEffectRow
  | PromotionAttemptRow
  | PromotionResponseRow
  | PromotionObservationRow;
export type PromotionStoredCommand =
  | Exclude<
      MediaPromotionCommand,
      | { type: 'DECLARE_EFFECT' }
      | { type: 'REVOKE' }
      | { type: 'AUTHORIZE_ATTEMPT' }
    >
  | (Extract<MediaPromotionCommand, { type: 'AUTHORIZE_ATTEMPT' }> & {
      dispatcherInstanceId: string;
    })
  | {
      type: 'DECLARE_EFFECT';
      effectId: string;
      uploadId: string;
      bucket: string;
    };
export interface MediaPromotionPersistence {
  open(selection: PromotionSelection): Promise<PromotionGateRow>;
  apply(
    selection: PromotionSelection,
    expectedRevision: number,
    command: PromotionStoredCommand,
  ): Promise<PromotionGateRow>;
  revoke(
    selection: PromotionSelection,
    expectedRevision: number | undefined,
    audit: PromotionAudit,
  ): Promise<PromotionGateRow>;
  read(
    selection: PromotionSelection,
    recordId?: string,
  ): Promise<{
    coverage: 'INCOMPLETE';
    remoteEffects: 'NOT_ASSESSED';
    gate: PromotionGateRow | null;
    record: PromotionRow | null;
  }>;
}

export function promotionInteger(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new ConflictError('Invalid promotion counter');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConflictError('Invalid promotion row object');
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).some((k) => !keys.includes(k)))
    throw new ConflictError('Unexpected promotion row field');
  return row;
}
function string(value: unknown): string {
  if (typeof value !== 'string')
    throw new ConflictError('Invalid promotion string');
  return value;
}
const id = (value: unknown) => promotionId(string(value));
export function decodePromotionScope(value: unknown): MediaPromotionScope {
  const s = exact(value, [
    'operationId',
    'instanceId',
    'animalId',
    'ownerId',
    'ownershipVersion',
    'kind',
  ]);
  if (s.kind !== 'PROFILE_CONFIRM' && s.kind !== 'ATTACHMENT_CONFIRM')
    throw new ConflictError('Invalid promotion scope kind');
  return {
    operationId: id(s.operationId),
    instanceId: id(s.instanceId),
    animalId: id(s.animalId),
    ownerId: id(s.ownerId),
    ownershipVersion: promotionInteger(s.ownershipVersion, 1),
    kind: s.kind,
  };
}
export function decodePromotionAudit(value: unknown): PromotionAudit {
  const a = exact(value, ['requestId', 'operatorId', 'evidenceRef']);
  return {
    requestId: id(a.requestId),
    operatorId: id(a.operatorId),
    evidenceRef: promotionEvidenceRef(string(a.evidenceRef)),
  };
}
export function validatePromotionSelection(
  selection: PromotionSelection,
): PromotionSelection {
  return {
    operationId: promotionId(selection.operationId),
    instanceId: promotionId(selection.instanceId),
    animalId: promotionId(selection.animalId),
  };
}
export function assertPromotionSelection(
  gate: PromotionGateRow,
  selection: PromotionSelection,
): void {
  if (
    gate.operationId !== selection.operationId ||
    gate.data.scope.instanceId !== selection.instanceId ||
    gate.data.scope.animalId !== selection.animalId
  )
    throw new ConflictError('The promotion selection changed');
}

/** Strict hydration, without defaults/casts that could erase corrupt persisted evidence. */
export function decodePromotionRow(
  value: unknown,
  gate?: PromotionGateRow,
): PromotionRow {
  const r = object(value);
  const common = [
    '_id',
    '__v',
    'id',
    'identityIds',
    'operationId',
    'protocol',
    'kind',
    'gateRevision',
    'data',
  ];
  const base: BaseRow = {
    id: id(r.id),
    operationId: id(r.operationId),
    protocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
    gateRevision: promotionInteger(r.gateRevision),
    identityIds: [],
  };
  const identities = [base.id];
  if (r.kind === 'ATTEMPT' && r.authorizationId !== undefined)
    identities.push(id(r.authorizationId));
  if (r.kind === 'GATE' && object(object(r.data).gate).state === 'REVOKED')
    identities.push(id(object(object(r.data).gate).requestId));
  if (
    !Array.isArray(r.identityIds) ||
    r.identityIds.length !== identities.length ||
    identities.some((v, i) => (r.identityIds as unknown[])[i] !== v) ||
    new Set(identities).size !== identities.length
  )
    throw new ConflictError('Invalid promotion identity registry');
  base.identityIds = identities;
  if (
    r.protocol !== base.protocol ||
    (gate &&
      (base.operationId !== gate.operationId ||
        base.gateRevision > gate.gateRevision))
  )
    throw new ConflictError('The promotion row protocol or operation changed');
  if (r.kind === 'GATE') {
    exact(r, common);
    const d = exact(r.data, ['scope', 'gate', 'effectCount']);
    const scope = decodePromotionScope(d.scope),
      g = object(d.gate);
    if (base.id !== base.operationId || scope.operationId !== base.id)
      throw new ConflictError('Invalid promotion gate identity');
    let state: PromotionGateRow['data']['gate'];
    if (g.state === 'OPEN') {
      exact(g, ['state']);
      state = { state: 'OPEN' };
    } else if (g.state === 'REVOKED') {
      exact(g, ['state', 'requestId', 'operatorId', 'evidenceRef']);
      state = {
        state: 'REVOKED',
        ...decodePromotionAudit({
          requestId: g.requestId,
          operatorId: g.operatorId,
          evidenceRef: g.evidenceRef,
        }),
      };
      if (base.gateRevision < 1)
        throw new ConflictError('Invalid tombstone revision');
    } else throw new ConflictError('Invalid promotion gate state');
    return {
      ...base,
      kind: 'GATE',
      data: {
        scope,
        gate: state,
        effectCount: promotionInteger(d.effectCount),
      },
    };
  }
  if (!gate || base.gateRevision < 1)
    throw new ConflictError('A promotion row requires its gate');
  const effectId = id(r.effectId);
  if (r.kind === 'EFFECT') {
    exact(r, [...common, 'effectId', 'uploadId', 'bucket', 'destinationKey']);
    const d = exact(r.data, [
      'definition',
      'definitionHash',
      'attemptCount',
      'lastAttemptId',
    ]);
    const def = exact(d.definition, [
      'bucket',
      'uploadId',
      'source',
      'destinationKey',
      'mimeType',
      'destinationIfNoneMatch',
    ]);
    const source = exact(def.source, [
      'key',
      'etag',
      'versionId',
      'size',
      'sha256',
    ]);
    const size = promotionInteger(source.size, 1);
    const definition = promotionDefinition(
      gate.data.scope,
      {
        id: id(def.uploadId),
        ownerId: gate.data.scope.ownerId,
        animalId: gate.data.scope.animalId,
        finalKey: string(def.destinationKey),
        stagingKey: string(source.key),
        mimeType: string(def.mimeType),
        size,
        createdAt: '',
        pinned: {
          etag: string(source.etag),
          size,
          sha256: string(source.sha256),
          ...(source.versionId === undefined
            ? {}
            : { versionId: string(source.versionId) }),
        },
      },
      string(def.bucket),
    );
    if (
      def.destinationIfNoneMatch !== '*' ||
      base.id !== effectId ||
      r.uploadId !== definition.uploadId ||
      r.bucket !== definition.bucket ||
      r.destinationKey !== definition.destinationKey ||
      d.definitionHash !==
        promotionDefinitionHash(gate.data.scope, effectId, definition)
    )
      throw new ConflictError('Invalid promotion definition binding');
    const count = promotionInteger(d.attemptCount);
    if ((count === 0) !== (d.lastAttemptId === undefined))
      throw new ConflictError('Invalid promotion last attempt');
    return {
      ...base,
      kind: 'EFFECT',
      effectId,
      uploadId: definition.uploadId,
      bucket: definition.bucket,
      destinationKey: definition.destinationKey,
      data: {
        definition,
        definitionHash: string(d.definitionHash),
        attemptCount: count,
        ...(d.lastAttemptId === undefined
          ? {}
          : { lastAttemptId: id(d.lastAttemptId) }),
      },
    };
  }
  if (r.kind === 'ATTEMPT') {
    exact(r, [...common, 'effectId', 'ordinal', 'authorizationId']);
    const d = exact(r.data, [
      'dispatcherInstanceId',
      'origin',
      'previousAttemptId',
    ]);
    const ordinal = promotionInteger(r.ordinal, 1);
    if (
      !['INITIAL', 'APPLICATION_RETRY', 'SDK_RETRY'].includes(
        string(d.origin),
      ) ||
      (ordinal === 1
        ? d.origin !== 'INITIAL' || d.previousAttemptId !== undefined
        : d.origin === 'INITIAL' || d.previousAttemptId === undefined)
    )
      throw new ConflictError('Invalid persisted promotion attempt chain');
    return {
      ...base,
      kind: 'ATTEMPT',
      effectId,
      ordinal,
      ...(r.authorizationId === undefined
        ? {}
        : { authorizationId: id(r.authorizationId) }),
      data: {
        dispatcherInstanceId: id(d.dispatcherInstanceId),
        origin: d.origin as PromotionAttempt['origin'],
        ...(d.previousAttemptId === undefined
          ? {}
          : { previousAttemptId: id(d.previousAttemptId) }),
      },
    };
  }
  if (r.kind === 'RESPONSE') {
    exact(r, [...common, 'effectId', 'attemptId']);
    const d = exact(r.data, ['outcome', 'evidenceRef']);
    if (d.outcome !== 'UNKNOWN' && d.outcome !== 'ACKNOWLEDGED')
      throw new ConflictError('Invalid persisted response');
    return {
      ...base,
      kind: 'RESPONSE',
      effectId,
      attemptId: id(r.attemptId),
      data: {
        outcome: d.outcome,
        evidenceRef: promotionEvidenceRef(string(d.evidenceRef)),
      },
    };
  }
  if (r.kind !== 'OBSERVATION')
    throw new ConflictError('Unknown promotion row kind');
  exact(r, [...common, 'effectId']);
  const d = object(r.data);
  if (d.finding === 'ABSENT' || d.finding === 'CONFLICT') {
    exact(d, ['finding', 'evidenceRef']);
    return {
      ...base,
      kind: 'OBSERVATION',
      effectId,
      data: {
        finding: d.finding,
        evidenceRef: promotionEvidenceRef(string(d.evidenceRef)),
      },
    };
  }
  exact(d, ['finding', 'evidenceRef', 'uploadId', 'sha256', 'revision']);
  const rev = exact(d.revision, ['etag', 'size', 'versionId']);
  if (d.finding !== 'MATCH')
    throw new ConflictError('Invalid persisted observation');
  // Semantic content/provenance validation additionally uses the parent effect.
  return {
    ...base,
    kind: 'OBSERVATION',
    effectId,
    data: {
      finding: 'MATCH',
      evidenceRef: promotionEvidenceRef(string(d.evidenceRef)),
      uploadId: id(d.uploadId),
      sha256: string(d.sha256),
      revision: {
        etag: string(rev.etag),
        size: promotionInteger(rev.size, 1),
        ...(rev.versionId === undefined
          ? {}
          : { versionId: string(rev.versionId) }),
      },
    },
  };
}

/** A bounded view of one effect/attempt reuses pure transition guards; DB indexes enforce global uniqueness. */
export function promotionTransitionView(
  gate: PromotionGateRow,
  effect?: PromotionEffectRow,
  attempt?: PromotionAttemptRow,
): MediaPromotionModel {
  return {
    protocol: 'MEDIA_PROMOTION_EFFECT_MODEL_V1',
    scope: gate.data.scope,
    revision: gate.gateRevision,
    gate:
      gate.data.gate.state === 'OPEN'
        ? { state: 'OPEN' }
        : {
            state: 'REVOKED',
            requestId: gate.data.gate.requestId,
            evidenceRef: gate.data.gate.evidenceRef,
          },
    effects: effect
      ? [
          {
            id: effect.id,
            definition: effect.data.definition,
            definitionHash: effect.data.definitionHash,
            attempts: attempt
              ? [
                  {
                    id: attempt.id,
                    ordinal: attempt.ordinal,
                    ...attempt.data,
                    ...(attempt.authorizationId === undefined
                      ? {}
                      : { authorizationId: attempt.authorizationId }),
                    responses: [],
                  },
                ]
              : [],
            observations: [],
          },
        ]
      : [],
  };
}

export function validatePromotionObservation(
  gate: PromotionGateRow,
  effect: PromotionEffectRow,
  row: PromotionObservationRow,
): void {
  advanceMediaPromotion(
    { ...promotionTransitionView(gate, effect), revision: 0 },
    0,
    {
      type: 'OBSERVE_DESTINATION',
      effectId: effect.id,
      observation: { id: row.id, ...row.data } as PromotionObservation,
    },
  );
}
