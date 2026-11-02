import { TransferItemCapture } from '../../../src/context/animal-transfer/application/transfer-item-capture';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { acceptanceStartStore } from './acceptance-start-store.fixture';
import { archiveAnimal } from './ownership-archive.fixture';

export async function historicalCopyPreparationFixture() {
  const f = acceptanceStartStore();
  const receipt = await f.service.start(f.input);
  const selected = receipt.binding.selected[0];
  const archive = f.state.db.archives.find(
    (a) => a.id === selected.archiveId,
  )! as unknown as OwnershipArchive;
  Object.assign(archive, {
    state: 'COPYING',
    capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
    expectedEntryCount: 1,
    expectedFileCount: 1,
  });
  const store = new MongoTransferItemCapture(
    ...([
      f.models[0],
      f.models[1],
      f.models[2],
      f.models[9],
      f.models[4],
      f.models[5],
      f.models[12],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  const capture = { captureBatch: jest.fn() };
  const service = new TransferItemCapture(store, capture);
  const selector = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: 2,
    expectedCaptureRevision: 3,
  };
  const key = `users/${archive.ownerId}/animals/${archive.animalId}/profile/photo.jpg`;
  const built = buildArchiveEntry(
    archive,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: archive.animalId,
        ownerId: archive.ownerId,
        profilePictureUrl: `https://test/${key}`,
      },
    },
    (url) => url.slice(13),
  );
  const definition = {
    ...built.files[0],
    source: { etag: 'source', size: 12, versionId: 'v1' },
  };
  const file: ArchiveFile = {
    ...definition,
    definitionHash: archiveHash(definition),
    state: 'PENDING',
  };
  f.state.db.files.push(file as unknown as Record<string, unknown>);
  const observation = await service.inspectCopyPreparation(selector);
  const input = {
    selector,
    fileId: file.id,
    expectedFileDefinitionHash: file.definitionHash,
    expectedSealHash: observation.observedSealHash,
    bucket: 'test-archive-bucket',
    sourceSha256: 'a'.repeat(64),
  };
  f.state.writes = 0;
  f.calls.length = 0;
  return { ...f, service, store, capture, input };
}
