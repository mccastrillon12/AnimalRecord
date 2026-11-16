import { Mongoose } from 'mongoose';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { OwnershipArchiveEntrySchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { metadataRevalidationFixture } from '../fixtures/ownership-archive-metadata-revalidation.fixture';

describe('Archive entry BSON preparation preserves the hashed snapshot (no connection)', () => {
  const model = new Mongoose().model(
    'ArchiveEntrySerialization',
    OwnershipArchiveEntrySchema.clone(),
  );
  it.each([false, true])(
    'preserves empty objects and bindings in new and retained snapshots (retained=%s)',
    (retained) => {
      const fixture = metadataRevalidationFixture(1, true, retained);
      for (const entry of fixture.entries) {
        const document = new model(entry);
        expect(document.validateSync()).toBeUndefined();
        const stored = document.toObject();
        expect(stored.payload).toEqual(entry.payload);
        expect(stored.fileBindings).toEqual(entry.fileBindings);
        expect(
          archiveHash({
            kind: stored.kind,
            payload: stored.payload,
            fileBindings: stored.fileBindings,
            ...(stored.retained ? { retained: stored.retained } : {}),
          }),
        ).toBe(entry.contentHash);
      }
    },
  );
});
