import { MediaRevision } from './animal-media-upload';
import {
  decodePromotionRow,
  promotionInteger,
  PromotionEffectRow,
  PromotionGateRow,
  PromotionSelection,
} from './media-promotion-persistence';
import { MediaPromotionDefinition } from './media-promotion-effect';
import { PromotionObservation } from './media-promotion-machine';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

/** Captured snapshot only. sealVerified must fence all current records itself. */
export type PromotionSealSubject = {
  gate: PromotionGateRow;
  effect: PromotionEffectRow;
  ticketRevision?: number;
};
export type PromotionMatch = Extract<
  PromotionObservation,
  { finding: 'MATCH' }
>;
export interface MediaPromotionSealingPersistence {
  readForSeal(
    selection: PromotionSelection,
    effectId: string,
  ): Promise<PromotionSealSubject>;
  sealVerified(
    selection: PromotionSelection,
    subject: PromotionSealSubject,
    observation: PromotionMatch,
  ): Promise<void>;
}

export function capturePromotionSealSubject(
  raw: PromotionSealSubject,
): PromotionSealSubject {
  const gate = decodePromotionRow(raw.gate);
  if (gate.kind !== 'GATE')
    throw new ConflictError('Invalid verification gate');
  const effect = decodePromotionRow(raw.effect, gate);
  if (effect.kind !== 'EFFECT' || gate.data.effectCount < 1)
    throw new ConflictError('Invalid verification effect');
  const ticketRevision = raw.ticketRevision;
  if (
    ticketRevision !== undefined &&
    promotionInteger(ticketRevision) >= Number.MAX_SAFE_INTEGER
  )
    throw new ConflictError('The promotion ticket fence is exhausted');
  return {
    gate,
    effect,
    ...(ticketRevision === undefined ? {} : { ticketRevision }),
  };
}

export type PromotionDestinationRevision = {
  etag?: string;
  size?: number;
  versionId?: string;
};
export type PromotionDestinationHead = PromotionDestinationRevision & {
  bucket: string;
  key: string;
  mimeType?: string;
  uploadId?: string;
  sha256?: string;
};
/** Read-only port: its implementation must bind requests to definition bucket/key. */
export interface MediaPromotionDestinationReader {
  head(
    definition: MediaPromotionDefinition,
  ): Promise<PromotionDestinationHead | null>;
  read(
    definition: MediaPromotionDefinition,
    revision: MediaRevision,
  ): Promise<{
    revision: PromotionDestinationRevision;
    body: AsyncIterable<Uint8Array>;
    close: () => void;
  }>;
}
