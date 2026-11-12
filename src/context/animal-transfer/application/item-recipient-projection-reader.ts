import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ArchiveEntry, archiveHash } from '../domain/ownership-archive';
import {
  ArchiveProjectionUrls,
  ITEM_RECIPIENT_PROJECTION_PROTOCOL,
  projectItemRecipientEntries,
} from '../domain/ownership-archive-recipient-projection';
import { archiveDefinitionOnly } from '../domain/ownership-archive-reservation';
import type { ItemCaptureStore } from '../domain/transfer-item-capture';
import {
  ITEM_MANIFEST_PAGE_SIZE,
  ItemManifestCursor,
  ItemManifestDigest,
  ItemManifestDigestInput,
} from '../domain/transfer-item-manifest-digest';
import {
  ItemRecipientFinalCoverageInput,
  recipientFinalCoverageInput,
} from '../domain/transfer-item-recipient-final-coverage';
import { itemRecipientProjectionSelection } from '../domain/transfer-item-recipient-projection-selection';
import type { ItemRecipientFinalCoverageObserver } from './item-recipient-final-coverage-observer';

/** Private in-memory candidate from the sealed capture and checked PREPARED registrations. */
export class ItemRecipientProjectionReader {
  constructor(
    private readonly store: Pick<ItemCaptureStore, 'readManifestPage'>,
    private readonly finalCoverage: Pick<
      ItemRecipientFinalCoverageObserver,
      'observeProjectionMedia'
    >,
    private readonly urls: ArchiveProjectionUrls,
  ) {}

  async read(raw: ItemRecipientFinalCoverageInput) {
    const input = recipientFinalCoverageInput(raw);
    const { selector, expectedSealHash } = input;
    const { entries, digest, snapshot } = await this.readEntries({
      selector,
      expectedSealHash,
    });
    const { manifest, coverage, media } =
      await this.finalCoverage.observeProjectionMedia(input);
    digest.assertEntriesMatch(snapshot, manifest);
    if (
      manifest.manifestHash !== input.expectedManifestHash ||
      coverage.manifestHash !== manifest.manifestHash ||
      archiveHash(coverage.binding) !== archiveHash(manifest.binding) ||
      coverage.requiredThrough !== input.requiredThrough ||
      coverage.filesDigest !== manifest.filesDigest ||
      coverage.fileCount !== manifest.fileCount ||
      media.length !== manifest.fileCount
    )
      throw new ConflictError(
        'The prepared media coverage does not match the sealed projection',
      );
    const definition = archiveDefinitionOnly(snapshot.archive!);
    const projection = {
      protocol: ITEM_RECIPIENT_PROJECTION_PROTOCOL,
      definition,
      binding: manifest.binding,
      manifestHash: manifest.manifestHash,
      preparedCoverageHash: coverage.observationHash,
      entries: projectItemRecipientEntries(
        definition,
        entries,
        media,
        this.urls,
      ),
      media,
      reservation: 'OBSERVED_ONLY' as const,
      stableCut: 'NOT_ASSESSED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    };
    return Object.freeze({
      ...projection,
      projectionHash: archiveHash(projection),
    });
  }

  async prepareSelection(raw: ItemRecipientFinalCoverageInput) {
    const input = recipientFinalCoverageInput(raw);
    const projection = await this.read(input);
    const selection = itemRecipientProjectionSelection({
      ...input,
      expectedPreparedCoverageHash: projection.preparedCoverageHash,
      expectedProjectionHash: projection.projectionHash,
    });
    return Object.freeze({ selection, projection });
  }

  private async readEntries(input: ItemManifestDigestInput) {
    const entries: ArchiveEntry[] = [];
    let digest: ItemManifestDigest | undefined;
    let cursor: ItemManifestCursor = {
      phase: 'ENTRIES',
      limit: ITEM_MANIFEST_PAGE_SIZE,
    };
    for (;;) {
      const page = await this.store.readManifestPage({ ...input, cursor });
      if (page?.phase !== 'ENTRIES')
        throw new ConflictError(
          'The projection requires the original sealed entry page',
        );
      digest ??= new ItemManifestDigest(input, page.snapshot, (url) =>
        this.urls.keyFromUrl(url),
      );
      const rows = structuredClone(page.rows);
      digest.appendEntries(page.snapshot, rows);
      if (!rows.length) return { entries, digest, snapshot: page.snapshot };
      entries.push(...rows);
      cursor = digest.nextPage;
    }
  }
}
