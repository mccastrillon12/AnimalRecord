import {
  ArchiveEntry,
  ArchiveFile,
  ArchiveRecordInput,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { archiveDefinition } from './ownership-archive.fixture';
import { buildArchiveReservation } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';

export const historyUuid = (n: number): string =>
  `123e4567-e89b-42d3-a456-426614174${String(n).padStart(3, '0')}`;
export const historyDigest = 'a'.repeat(64);
export const historyClone = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
export const historyArchive = (
  version: number,
  owner = version,
  recipient = version + 1,
): OwnershipArchive => {
  const definition = {
    ...archiveDefinition,
    id: historyUuid(100 + version),
    periodId: historyUuid(200 + version),
    transferId: historyUuid(300 + version),
    ownerId: historyUuid(owner),
    recipientId: historyUuid(recipient),
    ownershipVersion: version,
  };
  return {
    ...definition,
    definitionHash: archiveHash(definition),
    reservation: buildArchiveReservation(definition, 1),
    state: 'COLLECTING',
    createdAt: '2026-10-25T10:00:00.000Z',
  };
};
export const historyKeyFromUrl = (url: string): string | undefined =>
  url.startsWith('https://test/') ? url.slice(13) : undefined;
export function historyRecord(
  archive: OwnershipArchive,
  input: ArchiveRecordInput,
): { entry: ArchiveEntry; files: ArchiveFile[] } {
  const built = buildArchiveEntry(archive, input, historyKeyFromUrl);
  return {
    entry: built.entry,
    files: built.files.map((file) => {
      const definition = {
        ...file,
        source: { etag: 'source', size: 12, versionId: 'source-v1' },
      };
      return {
        ...definition,
        definitionHash: archiveHash(definition),
        state: 'VERIFIED',
        verified: {
          sha256: historyDigest,
          historical: { etag: 'history', size: 12, versionId: 'history-v1' },
          recipientStaging: {
            etag: 'staging',
            size: 12,
            versionId: 'staging-v1',
          },
        },
      };
    }),
  };
}
