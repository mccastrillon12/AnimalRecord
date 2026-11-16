import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { mediaConfirmationContext } from '../domain/media-confirmation-context';
import {
  MediaPromotionDispatchError,
  MediaPromotionDispatcherFactory,
} from '../domain/media-promotion-dispatch';
import { promotionId } from '../domain/media-promotion-effect';
import {
  PromotionConfirmationCall,
  PromotionConfirmationReceipt,
} from '../domain/media-promotion-confirmation-runner';
import {
  assertPromotionSelection,
  decodePromotionRow,
  MediaPromotionPersistence,
  PromotionSelection,
} from '../domain/media-promotion-persistence';
import {
  capturePromotionSealSubject,
  MediaPromotionDestinationReader,
  MediaPromotionSealingPersistence,
} from '../domain/media-promotion-sealing';
import {
  MediaPromotionVerificationError,
  MediaPromotionVerifier,
} from './media-promotion-verifier';

type Stage =
  | 'INPUT'
  | 'LIFECYCLE'
  | 'OPEN'
  | 'DECLARE'
  | 'INSPECT'
  | 'DISPATCH_SETUP'
  | 'DISPATCH'
  | 'READ'
  | 'VERIFY'
  | 'SEAL';
type Reason = 'CONFLICT' | 'UNAVAILABLE' | 'UNCERTAIN';
export class MediaPromotionConfirmationError extends Error {
  readonly name = 'MediaPromotionConfirmationError';
  readonly receipt?: PromotionConfirmationReceipt;
  constructor(
    readonly stage: Stage,
    readonly reason: Reason,
    receipt?: PromotionConfirmationReceipt,
  ) {
    super(`Media promotion confirmation stopped at ${stage}: ${reason}`);
    if (receipt) this.receipt = Object.freeze({ ...receipt });
  }
}
export type PromotionConfirmationInput = PromotionConfirmationCall & {
  bucket: string;
};

/** One shot, isolated from HTTP/Nest. No replay, old-grant adoption or business commit. */
export class MediaPromotionConfirmation {
  private used = false;
  constructor(
    private readonly persistence: MediaPromotionPersistence &
      MediaPromotionSealingPersistence,
    private readonly reader: MediaPromotionDestinationReader,
    private readonly dispatchers: MediaPromotionDispatcherFactory,
  ) {}

  async confirm(raw: PromotionConfirmationInput): Promise<void> {
    if (this.used)
      throw new MediaPromotionConfirmationError('LIFECYCLE', 'CONFLICT');
    this.used = true;
    let stage: Stage = 'INPUT';
    try {
      const input = Object.freeze({
        scope: mediaConfirmationContext(raw.scope),
        uploadId: promotionId(raw.uploadId),
        bucket: raw.bucket,
        effectId: promotionId(raw.effectId),
        dispatcherInstanceId: promotionId(raw.dispatcherInstanceId),
        observationId: promotionId(raw.observationId),
      });
      if (
        typeof input.bucket !== 'string' ||
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket) ||
        new Set([
          input.scope.operationId,
          input.scope.instanceId,
          input.uploadId,
          input.effectId,
          input.dispatcherInstanceId,
          input.observationId,
        ]).size !== 6
      )
        throw new InvalidArgumentError(
          'Invalid promotion identities or bucket',
        );
      const selection: PromotionSelection = Object.freeze({
        operationId: input.scope.operationId,
        instanceId: input.scope.instanceId,
        animalId: input.scope.animalId,
      });
      const gateAck = (rawGate: unknown, revision: number, count: number) => {
        const gate = decodePromotionRow(rawGate);
        if (gate.kind !== 'GATE') throw new ConflictError('Invalid gate');
        assertPromotionSelection(gate, selection);
        if (
          gate.gateRevision !== revision ||
          gate.data.effectCount !== count ||
          gate.data.gate.state !== 'OPEN' ||
          JSON.stringify(gate.data.scope) !== JSON.stringify(input.scope)
        )
          throw new ConflictError('The confirmation gate changed');
      };
      stage = 'OPEN';
      gateAck(await this.persistence.open(selection), 0, 0);
      stage = 'DECLARE';
      gateAck(
        await this.persistence.apply(selection, 0, {
          type: 'DECLARE_EFFECT',
          effectId: input.effectId,
          uploadId: input.uploadId,
          bucket: input.bucket,
        }),
        1,
        1,
      );
      const subject = capturePromotionSealSubject(
        await this.persistence.readForSeal(selection, input.effectId),
      );
      gateAck(subject.gate, 1, 1);
      const effect = subject.effect;
      if (
        effect.id !== input.effectId ||
        effect.uploadId !== input.uploadId ||
        effect.bucket !== input.bucket ||
        effect.data.attemptCount !== 0
      )
        throw new ConflictError('The confirmation effect changed');
      const definition = Object.freeze({
        ...effect.data.definition,
        source: Object.freeze({ ...effect.data.definition.source }),
      });
      stage = 'INSPECT';
      // Presence only chooses a path. The verifier rechecks bytes and acquires fences.
      const existing = await this.reader.head(definition);
      if (existing === null) {
        stage = 'DISPATCH_SETUP';
        const dispatcher = await this.dispatchers.create(
          Object.freeze({
            selection,
            scope: input.scope,
            effectId: input.effectId,
            dispatcherInstanceId: input.dispatcherInstanceId,
          }),
        );
        stage = 'DISPATCH';
        try {
          try {
            await dispatcher.send();
          } catch (error) {
            // Only the existing 409/412 reconciliation path; local errors always stop.
            const status = (
              error as { $metadata?: { httpStatusCode?: number } }
            )?.$metadata?.httpStatusCode;
            if (
              error instanceof MediaPromotionDispatchError ||
              (status !== 409 && status !== 412)
            )
              throw error;
          }
        } finally {
          dispatcher.destroy();
        }
      }
      stage = 'READ';
      await new MediaPromotionVerifier(
        this.persistence,
        this.reader,
      ).verifyAndSeal({
        selection,
        effectId: input.effectId,
        observationId: input.observationId,
        scope: input.scope,
      });
    } catch (error) {
      if (error instanceof MediaPromotionVerificationError)
        throw new MediaPromotionConfirmationError(error.stage, error.reason);
      throw new MediaPromotionConfirmationError(
        stage,
        error instanceof ConflictError || error instanceof InvalidArgumentError
          ? 'CONFLICT'
          : ['OPEN', 'DECLARE', 'DISPATCH'].includes(stage)
            ? 'UNCERTAIN'
            : 'UNAVAILABLE',
      );
    }
  }
}
