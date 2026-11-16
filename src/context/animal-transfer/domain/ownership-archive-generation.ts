import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { archiveHash } from './ownership-archive';

/** Chosen before any copy. Never probes S3 or changes an already issued intent. */
export function archiveGenerationKey(
  archiveId: string,
  fileId: string,
  plannedKey: string,
): string {
  new Uuid(archiveId);
  const parts = plannedKey.split('/');
  const fail = (): never => {
    throw new ConflictError('Unsupported archive generation destination');
  };
  if (
    !/^[a-f0-9]{64}$/.test(fileId) ||
    parts[0] !== 'users' ||
    parts[2] !== 'animals' ||
    parts.length < 5 ||
    parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))
  )
    fail();
  new Uuid(parts[1]);
  new Uuid(parts[3]);
  const prefix = parts.slice(0, 4).join('/');
  const relative = parts.slice(4).join('/');
  const photo = /^profile_\d+\.(jpeg|png|webp)$/.exec(relative);
  let key: string;
  if (photo) {
    // Decimal opaque identifier preserves current profile/media guard syntax.
    const identity = archiveHash(['ARCHIVE_GENERATION_V1', archiveId, fileId]);
    key = `${prefix}/profile_000${BigInt(`0x${identity}`).toString().padStart(78, '0')}.${photo[1]}`;
  } else {
    if (
      !['diary', 'medical-documents', 'retained-history'].includes(parts[4]) ||
      parts.length < 6
    )
      fail();
    key = `${parts.slice(0, -1).join('/')}/transfer-generations/${archiveId}/${fileId}/${parts[parts.length - 1]}`;
  }
  // Bound repeated generations; never silently shorten, flatten or truncate provenance.
  if (Buffer.byteLength(key, 'utf8') > 1024) fail();
  return key;
}
