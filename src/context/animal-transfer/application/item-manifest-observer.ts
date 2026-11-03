import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ItemCaptureStore } from '../domain/transfer-item-capture';
import {
  ItemManifestDigest,
  ItemManifestDigestInput,
  ItemManifestCursor,
  itemManifestDigestInput,
  ITEM_MANIFEST_PAGE_SIZE,
} from '../domain/transfer-item-manifest-digest';

/** Explicit internal composition only; read-only, no worker, provider or HTTP DTO. */
export class ItemManifestObserver {
  constructor(
    private readonly store: Pick<ItemCaptureStore, 'readManifestPage'>,
    private readonly keyFromUrl: (url: string) => string | undefined,
  ) {}
  async observe(raw: ItemManifestDigestInput) {
    const input = itemManifestDigestInput(raw);
    let digest: ItemManifestDigest | undefined;
    let cursor: ItemManifestCursor = Object.freeze({
      phase: 'ENTRIES',
      limit: ITEM_MANIFEST_PAGE_SIZE,
    });
    for (;;) {
      const page = await this.store.readManifestPage({ ...input, cursor });
      if (!page || page.phase !== cursor.phase)
        throw new ConflictError(
          'Item manifest reader returned another traversal phase',
        );
      digest ??= new ItemManifestDigest(input, page.snapshot, this.keyFromUrl);
      if (page.phase === 'ENTRIES')
        digest.appendEntries(page.snapshot, page.rows);
      else if (page.phase === 'FILES')
        digest.appendFiles(page.snapshot, page.rows);
      else return digest.finish(page.snapshot);
      cursor = digest.nextPage;
    }
  }
}
