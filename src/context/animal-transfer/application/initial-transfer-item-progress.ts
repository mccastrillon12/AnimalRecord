import type {
  InitialItemProgressPoint,
  ItemCaptureIdentity,
  ItemCaptureInput,
} from '../domain/transfer-item-capture';
import type { ItemRecipientProjectionSelection } from '../domain/transfer-item-recipient-projection-selection';
import type { ItemStableCutAccreditationSelection } from '../domain/transfer-item-stable-cut-evidence';
import type { ItemManifestPreparer } from './item-manifest-preparer';
import type { ItemRecipientProjectionReader } from './item-recipient-projection-reader';
import type { TransferAcceptanceProgress } from './transfer-acceptance-execution';
import type { TransferItemCapture } from './transfer-item-capture';

type Manifest = Awaited<ReturnType<ItemManifestPreparer['prepareFromCapture']>>;

export interface InitialItemCopyProgress {
  // Only a trusted provider can advance or reconcile copies. Null leaves the item processing.
  prepare(
    selector: ItemCaptureInput,
    manifest: Manifest,
  ): Promise<Readonly<{ requiredThrough: string }> | null>;
}

type CutSelection = Omit<
  ItemStableCutAccreditationSelection,
  'expectedAccreditationHash'
>;

export interface InitialItemProgressStore {
  readInitialProgress(
    item: ItemCaptureIdentity,
  ): Promise<InitialItemProgressPoint>;
  readStableCutScope(
    selection: ItemRecipientProjectionSelection,
  ): Promise<string>;
}

interface InitialItemCloser {
  readResumePoint(input: CutSelection): Promise<
    | Readonly<{ state: 'ACCEPTED' }>
    | Readonly<{
        state: 'PROCESSING';
        commitSelection: ItemStableCutAccreditationSelection | null;
      }>
  >;
  commit(input: ItemStableCutAccreditationSelection): Promise<unknown>;
}

export class InitialTransferItemProgress implements TransferAcceptanceProgress {
  constructor(
    private readonly store: InitialItemProgressStore,
    private readonly capture: Pick<TransferItemCapture, 'advance'>,
    private readonly manifests: Pick<
      ItemManifestPreparer,
      'prepareFromCapture'
    >,
    private readonly copies: InitialItemCopyProgress,
    private readonly projections: Pick<
      ItemRecipientProjectionReader,
      'prepareFromFinalVersions'
    >,
    private readonly registerCut: (
      input: CutSelection,
    ) => Promise<{ commitSelection: ItemStableCutAccreditationSelection }>,
    private readonly closer: InitialItemCloser,
  ) {}

  async resume(item: ItemCaptureIdentity): Promise<void> {
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

    const { selector } = current;
    const manifest = await this.manifests.prepareFromCapture(selector);
    const copies = await this.copies.prepare(selector, manifest);
    if (!copies) return;

    const { selection } = await this.projections.prepareFromFinalVersions({
      selector,
      expectedSealHash: manifest.observedSealHash,
      expectedManifestHash: manifest.manifestHash,
      requiredThrough: copies.requiredThrough,
    });
    const pin = {
      selection,
      expectedScopeHash: await this.store.readStableCutScope(selection),
    };
    const existing = await this.closer.readResumePoint(pin);
    if (existing.state === 'ACCEPTED') return;
    const commitSelection =
      existing.commitSelection ?? (await this.registerCut(pin)).commitSelection;
    await this.closer.commit(commitSelection);
  }
}
