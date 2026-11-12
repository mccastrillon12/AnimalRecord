import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import {
  ItemCopyRecordStore,
  ItemRecipientFinalPutReadInput,
  ItemStagingPutReadInput,
  recipientFinalPutReadInput,
  stagingPutReadInput,
} from '../domain/transfer-item-copy-record';
import type { ItemHistoricalPutVersionReader } from '../domain/transfer-item-historical-put-reconciliation';
import {
  ItemSourceArtifactDraft,
  ItemSourceArtifactReader,
  OpenItemSourceArtifact,
  ItemSourceArtifactIdentity,
  captureItemSourceArtifactIdentity,
} from '../domain/transfer-item-source-artifact';
import {
  ItemStagingPutArtifactSeal,
  ItemRecipientFinalPutArtifactSeal,
  buildRecipientFinalPutArtifactSeal,
  buildStagingPutArtifactSeal,
  captureRecipientFinalPutArtifactSeal,
  captureStagingPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import type { ItemStagingPutAttempt } from '../domain/transfer-item-staging-put-attempt';
import type { ItemRecipientFinalPutAttempt } from '../domain/transfer-item-recipient-final-put-attempt';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

type VersionedPutArtifactAccess<Input, Attempt, Seal> = Readonly<{
  leg: 'staging' | 'final';
  captureInput(raw: Input): Input;
  readAttempt(input: Input): Promise<
    Readonly<{
      definition: Attempt;
      destinationProtection: Readonly<{ protectionHash: string }>;
      permission?: unknown;
    }>
  >;
  buildSeal(
    attempt: Attempt,
    protectionHash: string,
    identity: ItemSourceArtifactIdentity,
    observedAt: string,
  ): Seal;
  captureSeal(raw: Seal): Seal;
}>;

/** Internal preparation with explicit reader and custody, outside the store transactions. */
class VersionedPutArtifacts<
  Input,
  Attempt extends ItemStagingPutAttempt | ItemRecipientFinalPutAttempt,
  Seal extends ItemStagingPutArtifactSeal | ItemRecipientFinalPutArtifactSeal,
> {
  constructor(
    private readonly access: VersionedPutArtifactAccess<Input, Attempt, Seal>,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async seal(raw: Input, draft: ItemSourceArtifactDraft<Seal>): Promise<Seal> {
    let sealStarted = false;
    try {
      const input = this.access.captureInput(raw);
      const identity = captureItemSourceArtifactIdentity(draft.identity);
      const { definition, destinationProtection } =
        await this.readUnpermitted(input);
      const {
        bucket,
        key,
        expectedBucketOwner,
        versionId,
        ifMatch,
        contentLength,
        sha256,
      } = definition.read;
      const target = Object.freeze({ bucket, key, expectedBucketOwner });
      const revision = Object.freeze({
        versionId,
        etag: ifMatch,
        size: contentLength,
      });
      try {
        const read = await this.versions.readVersion(target, revision);
        await verifyHistoricalObjectBytes(
          read,
          revision,
          sha256,
          () => this.invalid(),
          (bytes) => draft.write(bytes),
        );
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new ExternalServiceError(
          `The source version could not be read for the ${this.access.leg} PUT`,
        );
      }
      const checkedAt = this.now().getTime();
      if (!Number.isFinite(checkedAt)) throw this.invalid();
      const seal = this.access.buildSeal(
        definition,
        destinationProtection.protectionHash,
        identity,
        new Date(checkedAt).toISOString(),
      );
      await this.checkDeclaration(input, seal);
      sealStarted = true;
      await draft.seal(seal);
      await this.checkDeclaration(input, seal);
      return seal;
    } catch (error) {
      if (!sealStarted) {
        try {
          await draft.discard();
        } catch {
          // Preserve the failure that interrupted preparation.
        }
      }
      throw error;
    }
  }

  async open(
    raw: Input,
    expected: Seal,
    reader: ItemSourceArtifactReader<Seal>,
  ): Promise<OpenItemSourceArtifact<Seal>> {
    const input = this.access.captureInput(raw);
    const seal = this.access.captureSeal(expected);
    await this.checkDeclaration(input, seal);
    const opened = await reader.open(captureItemSourceArtifactIdentity(seal));
    if (!opened)
      throw new ConflictError(
        `The sealed ${this.access.leg} PUT artifact is unavailable`,
      );
    const close = opened.close.bind(opened);
    try {
      const { body } = opened;
      if (
        this.access.captureSeal(opened.seal).artifactHash !==
          seal.artifactHash ||
        typeof body?.[Symbol.asyncIterator] !== 'function'
      )
        throw this.invalid();
      await this.checkDeclaration(input, seal);
      return Object.freeze({ seal, body, close });
    } catch (error) {
      try {
        close();
      } catch {
        // Preserve the rejection that made the handle unusable.
      }
      throw error;
    }
  }

  private async checkDeclaration(input: Input, seal: Seal) {
    const { definition, destinationProtection } =
      await this.readUnpermitted(input);
    const expected = this.access.buildSeal(
      definition,
      destinationProtection.protectionHash,
      seal,
      seal.observedAt,
    );
    if (expected.artifactHash !== seal.artifactHash) throw this.invalid();
  }

  private async readUnpermitted(input: Input) {
    const record = await this.access.readAttempt(input);
    if (record.permission)
      throw new ConflictError(
        `The ${this.access.leg} PUT already has a permission`,
      );
    return record;
  }

  private invalid() {
    return new ConflictError(
      `The ${this.access.leg} PUT artifact does not match its exact declaration`,
    );
  }
}

export class ItemStagingPutArtifacts extends VersionedPutArtifacts<
  ItemStagingPutReadInput,
  ItemStagingPutAttempt,
  ItemStagingPutArtifactSeal
> {
  constructor(
    store: Pick<ItemCopyRecordStore, 'readStagingPutAttempt'>,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'staging',
        captureInput: stagingPutReadInput,
        readAttempt: (input) => store.readStagingPutAttempt(input),
        buildSeal: buildStagingPutArtifactSeal,
        captureSeal: captureStagingPutArtifactSeal,
      },
      versions,
      now,
    );
  }
}

export class ItemRecipientFinalPutArtifacts extends VersionedPutArtifacts<
  ItemRecipientFinalPutReadInput,
  ItemRecipientFinalPutAttempt,
  ItemRecipientFinalPutArtifactSeal
> {
  constructor(
    store: Pick<ItemCopyRecordStore, 'readRecipientFinalPutAttempt'>,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'final',
        captureInput: recipientFinalPutReadInput,
        readAttempt: (input) => store.readRecipientFinalPutAttempt(input),
        buildSeal: buildRecipientFinalPutArtifactSeal,
        captureSeal: captureRecipientFinalPutArtifactSeal,
      },
      versions,
      now,
    );
  }
}
