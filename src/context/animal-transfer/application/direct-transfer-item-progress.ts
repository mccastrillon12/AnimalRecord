import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  directCopyKey,
  directCopyLegs,
  type DirectCopyLeg,
  type DirectCopyPlan,
  type DirectCopyReceipt,
  type DirectCopyRecord,
  type DirectManifest,
  type DirectSourceProperties,
} from '../domain/direct-item-copy';
import type {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
} from '../domain/ownership-archive';
import type {
  InitialItemProgressPoint,
  ItemCaptureIdentity,
} from '../domain/transfer-item-capture';
import type { ItemManifestPreparer } from './item-manifest-preparer';
import type { TransferAcceptanceProgress } from './transfer-acceptance-execution';
import type { TransferItemCapture } from './transfer-item-capture';

interface DirectTransferStore {
  readInitialProgress(
    item: ItemCaptureIdentity,
  ): Promise<InitialItemProgressPoint>;
  readDirectCopies(
    input: DirectManifest,
  ): Promise<{ archive: OwnershipArchive; files: ArchiveFile[] }>;
  saveDirectCopy(
    input: DirectManifest,
    fileId: string,
    leg: DirectCopyLeg,
    plan: DirectCopyPlan,
    receipt?: DirectCopyReceipt,
  ): Promise<{ record: DirectCopyRecord; authorized: boolean }>;
  commitDirectOwnership(input: DirectManifest): Promise<unknown>;
}

export interface DirectTransferStorage {
  readonly bucket: string;
  readonly expectedBucketOwner: string;
  readonly retainUntil: string;
  readSource(
    key: string,
    revision: Readonly<ObjectRevision>,
  ): Promise<{ sha256: string; properties: DirectSourceProperties }>;
  dispatch(plan: DirectCopyPlan): Promise<void>;
  observe(plan: DirectCopyPlan): Promise<DirectCopyReceipt | null>;
}

export class DirectTransferItemProgress implements TransferAcceptanceProgress {
  constructor(
    private readonly store: DirectTransferStore,
    private readonly capture: Pick<TransferItemCapture, 'advance'>,
    private readonly manifests: Pick<
      ItemManifestPreparer,
      'prepareFromCapture'
    >,
    private readonly storage: DirectTransferStorage,
  ) {}

  async resume(item: ItemCaptureIdentity) {
    let current = await this.store.readInitialProgress(item);
    while (
      current.state === 'PROCESSING' &&
      current.progress.stage === 'COLLECTING'
    ) {
      await this.capture.advance(current.selector);
      const next = await this.store.readInitialProgress(item);
      if (
        next.state === 'PROCESSING' &&
        next.progress.stage === 'COLLECTING' &&
        next.progress.captureRevision <= current.progress.captureRevision
      )
        return;
      current = next;
    }
    if (current.state === 'ACCEPTED') return;
    if (!(Date.parse(this.storage.retainUntil) > Date.now()))
      throw new ConflictError('The configured transfer retention has ended');

    const { selector } = current;
    const sealed = await this.manifests.prepareFromCapture(selector);
    const input = {
      selector,
      expectedSealHash: sealed.observedSealHash,
      expectedManifestHash: sealed.manifestHash,
    };
    const { archive, files } = await this.store.readDirectCopies(input);
    for (const file of files) {
      let source:
        | Awaited<ReturnType<DirectTransferStorage['readSource']>>
        | undefined;
      for (const leg of directCopyLegs) {
        let record = file.directCopies?.[leg];
        if (!record) {
          source ??= await this.storage.readSource(file.sourceKey, file.source);
          const plan = {
            id: randomUUID(),
            bucket: this.storage.bucket,
            expectedBucketOwner: this.storage.expectedBucketOwner,
            retainUntil: this.storage.retainUntil,
            manifestHash: input.expectedManifestHash,
            fileDefinitionHash: file.definitionHash,
            sourceKey: file.sourceKey,
            source: file.source,
            destinationKey: directCopyKey(archive, file, leg),
            ...source,
          };
          const permission = await this.store.saveDirectCopy(
            input,
            file.id,
            leg,
            plan,
          );
          record = permission.record;
          if (permission.authorized) await this.storage.dispatch(record.plan);
        }
        const receipt = await this.storage.observe(record.plan);
        if (!receipt) return;
        await this.store.saveDirectCopy(
          input,
          file.id,
          leg,
          record.plan,
          receipt,
        );
      }
    }
    await this.store.commitDirectOwnership(input);
  }
}
