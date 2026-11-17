import { ConflictError } from '../../shared/domain/errors/ConflictError';
import type { ObjectRevision } from '../domain/ownership-archive';
import type {
  ItemCaptureInput,
  ItemCaptureStore,
} from '../domain/transfer-item-capture';
import type { ItemPutVersionSource } from '../domain/transfer-item-copy-intent';
import { captureItemArchiveFileDefinition } from '../domain/transfer-item-copy-intent';
import type { ItemCopyResumeInput } from '../domain/transfer-item-copy-record';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import {
  appendItemManifestFileDigest,
  captureItemManifestDigest,
  ITEM_MANIFEST_FILES_DIGEST_SEED,
  ITEM_MANIFEST_PAGE_SIZE,
  type ItemManifestDigestInput,
} from '../domain/transfer-item-manifest-digest';
import type { InitialItemCopyProgress } from './initial-transfer-item-progress';
import type { PutVersionAuditInput } from './put-version-audit-selection';

const copyStages = [
  'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
  'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
  'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
] as const satisfies readonly NonNullable<
  ItemCopyResumeInput['attempt']
>['protocol'][];
type CopyProtocol = (typeof copyStages)[number];

type FilePin = Readonly<{ fileId: string; expectedFileDefinitionHash: string }>;
export type InitialCopyStageInput = ItemManifestDigestInput &
  FilePin &
  Readonly<{ expectedManifestHash: string; protocol: CopyProtocol }>;
type InitialAudit = Extract<PutVersionAuditInput, { protocol: CopyProtocol }>;
export type InitialCopyStageState =
  | Readonly<{ state: 'ABSENT' | 'INTENDED' | 'REVOKED' }>
  | Readonly<{
      state: 'MAY_RUN';
      audit: InitialAudit;
      version: ItemPutVersionSource | null;
    }>;

export interface InitialCopyStageStore {
  readInitialCopyStage(
    input: InitialCopyStageInput,
  ): Promise<InitialCopyStageState>;
}

export interface InitialCopyDispatchPreparation {
  requiredThrough(
    input: ItemManifestDigestInput & { expectedManifestHash: string },
  ): Promise<string | null>;
  retainSource?(
    source: Readonly<{ key: string; revision: Readonly<ObjectRevision> }>,
    requiredThrough: string,
  ): Promise<void>;
  // Prepares and dispatches a fresh attempt using the existing guarded dispatcher.
  // A successful call still requires independent version evidence.
  dispatchFresh(
    input: InitialCopyStageInput & {
      requiredThrough: string;
      predecessor: ItemPutVersionSource | null;
    },
  ): Promise<void>;
}

interface VersionEvidence {
  publish(
    input: InitialAudit,
    requiredThrough: string,
  ): Promise<{ evidenceHash: string } | null>;
  reconcileAndRecord(
    input: InitialAudit,
    receipt: { evidenceHash: string },
    requiredThrough: string,
  ): Promise<unknown>;
}

export class InitialItemCopyExecution implements InitialItemCopyProgress {
  constructor(
    private readonly store: InitialCopyStageStore &
      Pick<ItemCaptureStore, 'readManifestPage'>,
    private readonly preparation: InitialCopyDispatchPreparation,
    private readonly evidence: VersionEvidence,
  ) {}

  async prepare(
    selector: ItemCaptureInput,
    manifest: Parameters<InitialItemCopyProgress['prepare']>[1],
  ) {
    const pin = {
      selector,
      expectedSealHash: manifest.observedSealHash,
      expectedManifestHash: manifest.manifestHash,
    };
    const requiredThrough = await this.preparation.requiredThrough(pin);
    if (requiredThrough === null) return null;
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const files = await this.readManifestFiles(pin, manifest.fileCount);
    for (const { source, ...file } of files) {
      let predecessor: ItemPutVersionSource | null = null;
      for (const protocol of copyStages) {
        const input = { ...pin, ...file, protocol };
        let progress = await this.store.readInitialCopyStage(input);
        if (progress.state === 'ABSENT') {
          if (protocol === 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1')
            await this.preparation.retainSource?.(source, requiredThrough);
          await this.preparation.dispatchFresh({
            ...input,
            requiredThrough,
            predecessor,
          });
          progress = await this.store.readInitialCopyStage(input);
        }
        if (progress.state !== 'MAY_RUN') return null;
        if (!progress.version) {
          const receipt = await this.evidence.publish(
            progress.audit,
            requiredThrough,
          );
          if (!receipt) return null;
          await this.evidence.reconcileAndRecord(
            progress.audit,
            receipt,
            requiredThrough,
          );
          progress = await this.store.readInitialCopyStage(input);
        }
        if (progress.state !== 'MAY_RUN' || !progress.version)
          throw new ConflictError(
            'The reconciled copy version could not be read',
          );
        if (
          historicalPutEvidenceTime(progress.version.requiredThrough) < horizon
        )
          throw new ConflictError(
            'The recorded copy does not cover the required horizon',
          );
        predecessor = progress.version;
      }
    }
    return { requiredThrough };
  }

  private async readManifestFiles(
    {
      selector,
      expectedSealHash,
      expectedManifestHash,
    }: ItemManifestDigestInput & { expectedManifestHash: string },
    expectedCount: number,
  ) {
    const files: Array<
      FilePin & {
        source: { key: string; revision: Readonly<ObjectRevision> };
      }
    > = [];
    let digest = ITEM_MANIFEST_FILES_DIGEST_SEED;
    let afterId: string | undefined;
    const invalid = () =>
      new ConflictError('The copy files do not match the sealed manifest');
    for (;;) {
      const page = await this.store.readManifestPage({
        selector,
        expectedSealHash,
        cursor: {
          phase: 'FILES',
          limit: ITEM_MANIFEST_PAGE_SIZE,
          ...(afterId && { afterId }),
        },
      });
      const archive = page.snapshot.archive;
      if (page.phase !== 'FILES' || !archive?.manifestDigest) throw invalid();
      const stored = captureItemManifestDigest(archive.manifestDigest);
      if (
        stored.manifestHash !== expectedManifestHash ||
        stored.binding.observedSealHash !== expectedSealHash ||
        stored.fileCount !== expectedCount ||
        page.rows.length > ITEM_MANIFEST_PAGE_SIZE ||
        files.length + page.rows.length > expectedCount
      )
        throw invalid();
      if (!page.rows.length) {
        if (files.length !== expectedCount || stored.filesDigest !== digest)
          throw invalid();
        return files;
      }
      for (const row of page.rows) {
        const file = captureItemArchiveFileDefinition(archive, row);
        if (afterId !== undefined && file.id <= afterId) throw invalid();
        files.push({
          fileId: file.id,
          expectedFileDefinitionHash: row.definitionHash,
          source: { key: file.sourceKey, revision: file.source },
        });
        digest = appendItemManifestFileDigest(
          digest,
          file.id,
          row.definitionHash,
        );
        afterId = file.id;
      }
    }
  }
}
