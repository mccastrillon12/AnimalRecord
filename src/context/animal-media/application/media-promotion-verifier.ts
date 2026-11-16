import { createHash } from 'node:crypto';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { MediaRevision } from '../domain/animal-media-upload';
import {
  mediaConfirmationContext,
  MediaConfirmationContext,
} from '../domain/media-confirmation-context';
import {
  MediaPromotionDefinition,
  promotionId,
  validRevisionText,
} from '../domain/media-promotion-effect';
import {
  assertPromotionSelection,
  PromotionSelection,
  validatePromotionSelection,
} from '../domain/media-promotion-persistence';
import {
  capturePromotionSealSubject,
  MediaPromotionDestinationReader,
  MediaPromotionSealingPersistence,
  PromotionDestinationHead,
  PromotionDestinationRevision,
  PromotionSealSubject,
} from '../domain/media-promotion-sealing';

type Stage = 'READ' | 'VERIFY' | 'SEAL';
type Reason = 'CONFLICT' | 'UNAVAILABLE' | 'UNCERTAIN';
export class MediaPromotionVerificationError extends Error {
  readonly name = 'MediaPromotionVerificationError';
  constructor(
    readonly stage: Stage,
    readonly reason: Reason,
  ) {
    super(`Media promotion verification stopped at ${stage}: ${reason}`);
  }
}
const conflict = () =>
  new ConflictError('The promotion destination does not match its definition');

/** Isolated: no module/provider, dispatcher, URL parser or mutation of S3. */
export class MediaPromotionVerifier {
  constructor(
    private readonly persistence: MediaPromotionSealingPersistence,
    private readonly reader: MediaPromotionDestinationReader,
  ) {}

  async verifyAndSeal(raw: {
    selection: PromotionSelection;
    effectId: string;
    observationId: string;
    scope: MediaConfirmationContext;
  }): Promise<void> {
    let selection: PromotionSelection,
      subject: PromotionSealSubject,
      observationId: string;
    try {
      selection = Object.freeze(validatePromotionSelection(raw.selection));
      observationId = promotionId(raw.observationId);
      const effectId = promotionId(raw.effectId),
        scope = mediaConfirmationContext(raw.scope);
      subject = capturePromotionSealSubject(
        await this.persistence.readForSeal(selection, effectId),
      );
      assertPromotionSelection(subject.gate, selection);
      if (
        subject.effect.id !== effectId ||
        JSON.stringify(subject.gate.data.scope) !== JSON.stringify(scope)
      )
        throw conflict();
    } catch (error) {
      throw this.failure('READ', error);
    }
    const definition = subject.effect.data.definition;
    // Reader cannot mutate the captured subject while awaiting its remote result.
    const query = Object.freeze({
      ...definition,
      source: Object.freeze({ ...definition.source }),
    });
    let revision: MediaRevision;
    try {
      revision = this.head(await this.reader.head(query), definition);
      const fixed = Object.freeze({ ...revision });
      const read = await this.reader.read(query, fixed);
      try {
        this.sameRevision(this.revision(read.revision), revision);
        let size = 0;
        const hash = createHash('sha256');
        for await (const chunk of read.body) {
          if (!(chunk instanceof Uint8Array) && !Buffer.isBuffer(chunk))
            throw conflict();
          if (chunk.byteLength > definition.source.size - size)
            throw conflict();
          size += chunk.byteLength;
          hash.update(chunk);
        }
        if (
          size !== definition.source.size ||
          hash.digest('hex') !== definition.source.sha256
        )
          throw conflict();
      } finally {
        read.close();
      }
      this.sameRevision(
        this.head(await this.reader.head(query), definition),
        revision,
      );
    } catch (error) {
      throw this.failure('VERIFY', error);
    }
    try {
      await this.persistence.sealVerified(selection, subject, {
        id: observationId,
        finding: 'MATCH',
        uploadId: definition.uploadId,
        sha256: definition.source.sha256,
        revision,
        evidenceRef: `verification:${observationId}`,
      });
    } catch (error) {
      throw this.failure('SEAL', error);
    }
  }

  private head(
    head: PromotionDestinationHead | null,
    definition: MediaPromotionDefinition,
  ): MediaRevision {
    if (
      !head ||
      head.bucket !== definition.bucket ||
      head.key !== definition.destinationKey ||
      head.mimeType !== definition.mimeType ||
      head.uploadId !== definition.uploadId ||
      head.sha256 !== definition.source.sha256 ||
      head.size !== definition.source.size
    )
      throw conflict();
    return this.revision(head);
  }
  private revision(value: PromotionDestinationRevision): MediaRevision {
    if (
      !validRevisionText(value.etag!) ||
      !Number.isSafeInteger(value.size) ||
      value.size! < 1 ||
      (value.versionId !== undefined && !validRevisionText(value.versionId))
    )
      throw conflict();
    return {
      etag: value.etag!,
      size: value.size!,
      ...(value.versionId === undefined ? {} : { versionId: value.versionId }),
    };
  }
  private sameRevision(a: MediaRevision, b: MediaRevision): void {
    if (a.etag !== b.etag || a.size !== b.size || a.versionId !== b.versionId)
      throw conflict();
  }
  private failure(
    stage: Stage,
    error: unknown,
  ): MediaPromotionVerificationError {
    return new MediaPromotionVerificationError(
      stage,
      error instanceof ConflictError || error instanceof InvalidArgumentError
        ? 'CONFLICT'
        : stage === 'SEAL'
          ? 'UNCERTAIN'
          : 'UNAVAILABLE',
    );
  }
}
