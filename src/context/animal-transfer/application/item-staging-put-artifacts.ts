import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import {
  ItemCopyRecordStore,
  ItemStagingPutReadInput,
  stagingPutReadInput,
} from '../domain/transfer-item-copy-record';
import type { ItemHistoricalPutVersionReader } from '../domain/transfer-item-historical-put-reconciliation';
import {
  ItemSourceArtifactDraft,
  ItemSourceArtifactReader,
  OpenItemSourceArtifact,
  captureItemSourceArtifactIdentity,
} from '../domain/transfer-item-source-artifact';
import {
  ItemStagingPutArtifactSeal,
  buildStagingPutArtifactSeal,
  captureStagingPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

const invalid = () =>
  new ConflictError(
    'The staging PUT artifact does not match its exact declaration',
  );

/** Internal preparation with explicit reader and custody, outside the store transactions. */
export class ItemStagingPutArtifacts {
  constructor(
    private readonly store: Pick<ItemCopyRecordStore, 'readStagingPutAttempt'>,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async seal(
    raw: ItemStagingPutReadInput,
    draft: ItemSourceArtifactDraft<ItemStagingPutArtifactSeal>,
  ): Promise<ItemStagingPutArtifactSeal> {
    let sealStarted = false;
    try {
      const input = stagingPutReadInput(raw);
      const identity = captureItemSourceArtifactIdentity(draft.identity);
      const { definition, destinationProtection } =
        await this.store.readStagingPutAttempt(input);
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
          invalid,
          (bytes) => draft.write(bytes),
        );
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new ExternalServiceError(
          'The historical version could not be read for staging',
        );
      }
      const checkedAt = this.now().getTime();
      if (!Number.isFinite(checkedAt)) throw invalid();
      const seal = buildStagingPutArtifactSeal(
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
    raw: ItemStagingPutReadInput,
    expected: ItemStagingPutArtifactSeal,
    reader: ItemSourceArtifactReader<ItemStagingPutArtifactSeal>,
  ): Promise<OpenItemSourceArtifact<ItemStagingPutArtifactSeal>> {
    const input = stagingPutReadInput(raw);
    const seal = captureStagingPutArtifactSeal(expected);
    await this.checkDeclaration(input, seal);
    const opened = await reader.open(captureItemSourceArtifactIdentity(seal));
    if (!opened)
      throw new ConflictError('The sealed staging PUT artifact is unavailable');
    const close = opened.close.bind(opened);
    try {
      const { body } = opened;
      if (
        captureStagingPutArtifactSeal(opened.seal).artifactHash !==
          seal.artifactHash ||
        typeof body?.[Symbol.asyncIterator] !== 'function'
      )
        throw invalid();
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

  private async checkDeclaration(
    input: ItemStagingPutReadInput,
    seal: ItemStagingPutArtifactSeal,
  ) {
    const { definition, destinationProtection } =
      await this.store.readStagingPutAttempt(input);
    const expected = buildStagingPutArtifactSeal(
      definition,
      destinationProtection.protectionHash,
      seal,
      seal.observedAt,
    );
    if (expected.artifactHash !== seal.artifactHash) throw invalid();
  }
}
