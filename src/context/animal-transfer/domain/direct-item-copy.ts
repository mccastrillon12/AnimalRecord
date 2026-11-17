import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { validate as isUuid } from 'uuid';
import { archiveGenerationKey } from './ownership-archive-generation';
import {
  archiveHash,
  type ArchiveFile,
  type ObjectRevision,
  type OwnershipArchive,
} from './ownership-archive';
import {
  captureItemArchiveFileDefinition,
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import type { ItemManifestDigestInput } from './transfer-item-manifest-digest';

export type DirectCopyLeg = 'historical' | 'recipient';
export const directCopyLegs = ['historical', 'recipient'] as const;
export type DirectManifest = ItemManifestDigestInput & {
  expectedManifestHash: string;
};
export type DirectSourceProperties = Readonly<{
  ContentType?: string;
  ContentEncoding?: string;
  ContentDisposition?: string;
  ContentLanguage?: string;
}>;
export type DirectCopyPlan = Readonly<{
  bucket: string;
  expectedBucketOwner: string;
  retainUntil: string;
  sourceKey: string;
  source: Readonly<ObjectRevision>;
  sha256: string;
  properties: DirectSourceProperties;
  destinationKey: string;
  manifestHash: string;
  fileDefinitionHash: string;
  id: string;
}>;
export type DirectCopyReceipt = Readonly<{
  revision: Readonly<ObjectRevision>;
  retainUntil: string;
}>;
export type DirectCopyRecord = Readonly<{
  plan: DirectCopyPlan;
  receipt?: DirectCopyReceipt;
}>;
export type DirectTransferPublication = Readonly<{
  manifestHash: string;
  copiesHash: string;
  effectiveAt: string;
  hash: string;
}>;

export function directCopyKey(
  archive: OwnershipArchive,
  file: ArchiveFile,
  leg: DirectCopyLeg,
) {
  return leg === 'historical'
    ? file.historicalKey
    : archiveGenerationKey(archive.id, file.id, file.recipientFinalKey);
}

export function checkDirectCopyPlan(
  plan: DirectCopyPlan,
  manifest: Pick<DirectManifest, 'expectedManifestHash'>,
  archive: OwnershipArchive,
  file: ArchiveFile,
  leg: DirectCopyLeg,
) {
  const fixed = captureItemArchiveFileDefinition(archive, file);
  if (
    plan.manifestHash !== manifest.expectedManifestHash ||
    plan.fileDefinitionHash !== file.definitionHash ||
    plan.sourceKey !== fixed.sourceKey ||
    archiveHash(plan.source) !== archiveHash(fixed.source) ||
    !isPinnedItemSourceVersion(fixed.source.versionId) ||
    plan.destinationKey !== directCopyKey(archive, file, leg) ||
    !/^[a-f0-9]{64}$/.test(plan.sha256) ||
    !isUuid(plan.id) ||
    !/^\d{12}$/.test(plan.expectedBucketOwner) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(plan.bucket) ||
    !Number.isFinite(Date.parse(plan.retainUntil))
  )
    throw new ConflictError(
      'The direct S3 copy does not match the sealed manifest',
    );
}

export function checkDirectCopyReceipt(
  plan: DirectCopyPlan,
  receipt: DirectCopyReceipt,
) {
  const revision = captureItemObjectRevision(receipt.revision);
  if (
    !isPinnedItemSourceVersion(revision.versionId) ||
    revision.size !== plan.source.size ||
    !(Date.parse(receipt.retainUntil) >= Date.parse(plan.retainUntil))
  )
    throw new ConflictError(
      'The verified S3 copy does not match its saved plan',
    );
}
