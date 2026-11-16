import { AnimalWriteJournal } from '../../animal-transfer/domain/animal-write-journal';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { AnimalMediaUpload, MediaRevision } from './animal-media-upload';
import {
  MEDIA_PROMOTION_PROTOCOL,
  MediaPromotionDefinition,
  MediaPromotionScope,
  promotionDefinition,
  promotionDefinitionHash,
  promotionEvidenceRef,
  promotionId,
  promotionScope,
  validRevisionText,
} from './media-promotion-effect';

export type PromotionAttempt = {
  id: string;
  ordinal: number;
  dispatcherInstanceId: string;
  origin: 'INITIAL' | 'APPLICATION_RETRY' | 'SDK_RETRY';
  previousAttemptId?: string;
  authorizationId?: string;
  responses: Array<{
    id: string;
    outcome: 'ACKNOWLEDGED' | 'UNKNOWN';
    evidenceRef: string;
  }>;
};
export type PromotionObservation = { id: string; evidenceRef: string } & (
  | {
      finding: 'MATCH';
      uploadId: string;
      sha256: string;
      revision: MediaRevision;
    }
  | { finding: 'ABSENT' | 'CONFLICT' }
);
export type PromotionEffect = {
  id: string;
  definition: MediaPromotionDefinition;
  definitionHash: string;
  attempts: PromotionAttempt[];
  observations: PromotionObservation[];
};
/** Reference aggregate in memory, NOT a BSON document or a dispatch capability. */
export type MediaPromotionModel = {
  protocol: typeof MEDIA_PROMOTION_PROTOCOL;
  scope: MediaPromotionScope;
  revision: number;
  gate:
    | { state: 'OPEN' }
    | { state: 'REVOKED'; requestId: string; evidenceRef: string };
  effects: PromotionEffect[];
};
export type MediaPromotionCommand =
  | {
      type: 'DECLARE_EFFECT';
      effectId: string;
      upload: AnimalMediaUpload;
      bucket: string;
    }
  | {
      type: 'INTEND_ATTEMPT';
      effectId: string;
      attemptId: string;
      dispatcherInstanceId: string;
      origin: PromotionAttempt['origin'];
      previousAttemptId?: string;
    }
  | {
      type: 'AUTHORIZE_ATTEMPT';
      effectId: string;
      attemptId: string;
      authorizationId: string;
    }
  | { type: 'REVOKE'; requestId: string; evidenceRef: string }
  | {
      type: 'RECORD_RESPONSE';
      effectId: string;
      attemptId: string;
      responseId: string;
      outcome: 'ACKNOWLEDGED' | 'UNKNOWN';
      evidenceRef: string;
    }
  | {
      type: 'OBSERVE_DESTINATION';
      effectId: string;
      observation: PromotionObservation;
    };

export function createMediaPromotionModel(
  journal: AnimalWriteJournal,
  animalId: string,
): MediaPromotionModel {
  return {
    protocol: MEDIA_PROMOTION_PROTOCOL,
    scope: promotionScope(journal, animalId),
    revision: 0,
    gate: { state: 'OPEN' },
    effects: [],
  };
}

/** Pure CAS specification. A real adapter must linearize this against revocation. */
export function advanceMediaPromotion(
  model: MediaPromotionModel,
  expectedRevision: number,
  command: MediaPromotionCommand,
): MediaPromotionModel {
  if (
    model.protocol !== MEDIA_PROMOTION_PROTOCOL ||
    !Number.isSafeInteger(model.revision) ||
    model.revision < 0 ||
    model.revision >= Number.MAX_SAFE_INTEGER ||
    model.revision !== expectedRevision
  )
    throw new ConflictError('The promotion model revision or protocol changed');
  for (const effect of model.effects)
    if (
      effect.definitionHash !==
      promotionDefinitionHash(model.scope, effect.id, effect.definition)
    )
      throw new ConflictError('The promotion definition changed');
  const next = structuredClone(model);
  const requiresOpen =
    command.type === 'DECLARE_EFFECT' ||
    command.type === 'INTEND_ATTEMPT' ||
    command.type === 'AUTHORIZE_ATTEMPT' ||
    command.type === 'REVOKE';
  if (requiresOpen && next.gate.state !== 'OPEN')
    throw new ConflictError('The promotion authorization gate is revoked');
  const unique = (id: string) => {
    promotionId(id);
    const ids = next.effects.flatMap((e) => [
      e.id,
      ...e.attempts.flatMap((a) => [
        a.id,
        ...(a.authorizationId ? [a.authorizationId] : []),
        ...a.responses.map((r) => r.id),
      ]),
      ...e.observations.map((o) => o.id),
    ]);
    if (next.gate.state === 'REVOKED') ids.push(next.gate.requestId);
    if (ids.includes(id))
      throw new ConflictError('The promotion identity has already been used');
  };
  if (command.type === 'REVOKE') {
    unique(command.requestId);
    next.gate = {
      state: 'REVOKED',
      requestId: command.requestId,
      evidenceRef: promotionEvidenceRef(command.evidenceRef),
    };
  } else if (command.type === 'DECLARE_EFFECT') {
    unique(command.effectId);
    const definition = promotionDefinition(
      next.scope,
      command.upload,
      command.bucket,
    );
    if (
      next.effects.some(
        (e) =>
          e.definition.uploadId === definition.uploadId ||
          e.definition.destinationKey === definition.destinationKey,
      )
    )
      throw new ConflictError(
        'The promotion resource already has an effect in this operation',
      );
    next.effects.push({
      id: command.effectId,
      definition,
      definitionHash: promotionDefinitionHash(
        next.scope,
        command.effectId,
        definition,
      ),
      attempts: [],
      observations: [],
    });
  } else {
    const effect = next.effects.find((e) => e.id === command.effectId);
    if (!effect) throw new ConflictError('The promotion effect is missing');
    if (command.type === 'INTEND_ATTEMPT') {
      unique(command.attemptId);
      const previous = effect.attempts[effect.attempts.length - 1];
      if (
        previous
          ? !previous.authorizationId ||
            command.previousAttemptId !== previous.id ||
            !['APPLICATION_RETRY', 'SDK_RETRY'].includes(command.origin)
          : command.origin !== 'INITIAL' ||
            command.previousAttemptId !== undefined
      )
        throw new InvalidArgumentError(
          'A retry must name the preceding authorized attempt',
        );
      effect.attempts.push({
        id: command.attemptId,
        ordinal: effect.attempts.length + 1,
        dispatcherInstanceId: promotionId(command.dispatcherInstanceId),
        origin: command.origin,
        ...(previous ? { previousAttemptId: previous.id } : {}),
        responses: [],
      });
    } else if (command.type === 'OBSERVE_DESTINATION') {
      const observation = command.observation;
      unique(observation.id);
      const base = {
        id: observation.id,
        evidenceRef: promotionEvidenceRef(observation.evidenceRef),
      };
      if (observation.finding === 'MATCH') {
        const revision = observation.revision;
        if (
          observation.uploadId !== effect.definition.uploadId ||
          observation.sha256 !== effect.definition.source.sha256 ||
          revision.size !== effect.definition.source.size ||
          !validRevisionText(revision.etag) ||
          (revision.versionId !== undefined &&
            !validRevisionText(revision.versionId))
        )
          throw new InvalidArgumentError(
            'The destination observation has different content or provenance',
          );
        effect.observations.push({
          ...base,
          finding: 'MATCH',
          uploadId: observation.uploadId,
          sha256: observation.sha256,
          revision: {
            etag: revision.etag,
            size: revision.size,
            ...(revision.versionId === undefined
              ? {}
              : { versionId: revision.versionId }),
          },
        });
      } else {
        if (
          observation.finding !== 'ABSENT' &&
          observation.finding !== 'CONFLICT'
        )
          throw new InvalidArgumentError('Invalid destination observation');
        effect.observations.push({ ...base, finding: observation.finding });
      }
    } else {
      const attempt = effect.attempts.find((a) => a.id === command.attemptId);
      if (!attempt) throw new ConflictError('The promotion attempt is missing');
      if (command.type === 'AUTHORIZE_ATTEMPT') {
        unique(command.authorizationId);
        if (attempt.authorizationId)
          throw new ConflictError(
            'The attempt was already authorized; do not resend',
          );
        attempt.authorizationId = command.authorizationId;
      } else {
        unique(command.responseId);
        if (
          !attempt.authorizationId ||
          !['ACKNOWLEDGED', 'UNKNOWN'].includes(command.outcome)
        )
          throw new InvalidArgumentError(
            'A response requires an authorized attempt',
          );
        attempt.responses.push({
          id: command.responseId,
          outcome: command.outcome,
          evidenceRef: promotionEvidenceRef(command.evidenceRef),
        });
      }
    }
  }
  next.revision++;
  return next;
}

/** Local evidence only. Even ACK/MATCH never discharges an authorization here. */
export function summarizeMediaPromotion(model: MediaPromotionModel) {
  const attempts = model.effects.flatMap((effect) => effect.attempts);
  return {
    coverage: 'INCOMPLETE' as const,
    remoteEffects: 'NOT_ASSESSED' as const,
    authorizedAttemptIds: attempts
      .filter((a) => a.authorizationId !== undefined)
      .map((a) => a.id),
    dispatchPrecludedAttemptIds:
      model.gate.state === 'REVOKED'
        ? attempts
            .filter((a) => a.authorizationId === undefined)
            .map((a) => a.id)
        : [],
    responses: attempts.flatMap((a) =>
      a.responses.map((r) => ({ attemptId: a.id, ...r })),
    ),
    observations: model.effects.flatMap((e) =>
      e.observations.map((o) => ({ effectId: e.id, ...structuredClone(o) })),
    ),
  };
}
