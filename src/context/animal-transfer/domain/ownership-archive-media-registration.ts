import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  assertArchiveMaterialization,
  assertMaterializationIntent,
  verifiedArchiveMaterializationDestination,
} from './ownership-archive-materialization';
import { ArchiveEntryReferencePlan } from './ownership-archive-reference-plan';
import type { ItemManifestDigestResult } from './transfer-item-manifest-digest';
import type { ItemRecipientFinalPutVersionContext } from './transfer-item-staging-put-reconciliation';
import { isPinnedItemSourceVersion } from './transfer-item-copy-intent';
import type { PublishedHistoryFinalPutVersionContext } from './published-history-final-reconciliation';

export const ARCHIVE_MEDIA_REGISTRATION_PROTOCOL =
  'ARCHIVE_MEDIA_REGISTRATION_V1' as const;
export const ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL =
  'ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_V1' as const;
export const PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL =
  'PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_V1' as const;

/** Evidence only, deliberately NOT an ordinary upload ticket or an access grant. */
export type ArchiveMediaRegistration = {
  protocol: typeof ARCHIVE_MEDIA_REGISTRATION_PROTOCOL;
  id: string;
  archiveId: string;
  archiveDefinitionHash: string;
  materializationDefinitionHash: string;
  fileId: string;
  fileDefinitionHash: string;
  intentDefinitionHash: string;
  animalId: string;
  fromOwnerId: string;
  recipientId: string;
  sourcePeriodId: string;
  sourceOwnershipVersion: number;
  transferId: string;
  key: string;
  revision: ObjectRevision;
  sha256: string;
  mode: 'LIVE_RESOURCE' | 'RETAINED_READ_ONLY';
  retained?: ArchiveFile['retained'];
  state: 'PREPARED';
  definitionHash: string;
};

export type ItemRecipientFinalMediaRegistration = Readonly<
  Omit<
    ArchiveMediaRegistration,
    'protocol' | 'materializationDefinitionHash' | 'retained' | 'mode'
  > & {
    protocol: typeof ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL;
    mode: 'LIVE_RESOURCE';
    itemEvidence: Readonly<{
      itemId: string;
      manifestHash: string;
      observedSealHash: string;
      attemptDefinitionHash: string;
      permissionHash: string;
      versionObservationHash: string;
      conservationControlsHash: string;
      requiredThrough: string;
    }>;
  }
>;
export type PublishedHistoryFinalMediaRegistration = Readonly<
  Omit<
    ArchiveMediaRegistration,
    'protocol' | 'materializationDefinitionHash' | 'retained' | 'mode'
  > & {
    protocol: typeof PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL;
    mode: 'RETAINED_READ_ONLY';
    retained: NonNullable<ArchiveFile['retained']>;
    publishedHistoryEvidence: Readonly<{
      sourceManifestHash: string;
      reservationEpoch: number;
      reservationBindingHash: string;
      attemptDefinitionHash: string;
      permissionHash: string;
      versionObservationHash: string;
      conservationControlsHash: string;
      requiredThrough: string;
      bucket: string;
      expectedBucketOwner: string;
    }>;
  }
>;

export type TransferredMediaRegistration =
  | ArchiveMediaRegistration
  | ItemRecipientFinalMediaRegistration
  | PublishedHistoryFinalMediaRegistration;

export interface OwnershipArchiveMediaRegistrationRepository {
  registerFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveMediaRegistration>;
}

export function assertMediaRegistrationArchive(
  archive: OwnershipArchive,
): void {
  assertArchiveMaterialization(archive);
  if (
    archive.materialization!.protocol !==
      ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL ||
    archive.materialization!.phase !== 'MATERIALIZED'
  )
    throw new ConflictError(
      'Media registration requires generational MATERIALIZED evidence',
    );
}

/** Derives identity from persisted verified evidence, never caller-supplied keys/revisions. */
export function buildArchiveMediaRegistration(
  archive: OwnershipArchive,
  file: ArchiveFile,
  plan: ArchiveEntryReferencePlan,
): ArchiveMediaRegistration {
  assertMediaRegistrationArchive(archive);
  const destination = verifiedArchiveMaterializationDestination(
    archive,
    file,
    plan,
  );
  const intent = file.materialization!.intent;
  assertMaterializationIntent(intent);
  const revision = destination.revision;
  if (
    plan.mode !== (file.retained ? 'RETAINED_READ_ONLY' : 'LIVE_RESOURCE') ||
    file.materialization!.leaseToken !== undefined ||
    file.materialization!.leaseUntil !== undefined ||
    typeof revision.etag !== 'string' ||
    !revision.etag ||
    (revision.versionId !== undefined &&
      (typeof revision.versionId !== 'string' || !revision.versionId))
  )
    throw new ConflictError('Media registration provenance is inconsistent');
  if (file.retained) {
    new Uuid(file.retained.rootArchiveId);
    new Uuid(file.retained.sourceArchiveId);
    if (
      file.retained.sourceArchiveId !== archive.history?.sourceArchiveId ||
      file.retained.sha256 !== destination.sha256 ||
      ![
        file.retained.rootFileId,
        file.retained.sourceFileId,
        file.retained.sourceDefinitionHash,
      ].every(
        (value) =>
          typeof value === 'string' &&
          value.length === 64 &&
          /^[a-f0-9]+$/.test(value),
      )
    )
      throw new ConflictError(
        'Retained media registration provenance is inconsistent',
      );
  }
  const definition: Omit<ArchiveMediaRegistration, 'definitionHash'> = {
    protocol: ARCHIVE_MEDIA_REGISTRATION_PROTOCOL,
    id: archiveHash([ARCHIVE_MEDIA_REGISTRATION_PROTOCOL, archive.id, file.id]),
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    materializationDefinitionHash: archive.materialization!.definitionHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    intentDefinitionHash: intent.definitionHash,
    animalId: archive.animalId,
    fromOwnerId: archive.ownerId,
    recipientId: archive.recipientId,
    sourcePeriodId: archive.periodId,
    sourceOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    key: destination.key,
    revision: {
      etag: revision.etag,
      size: revision.size,
      ...(revision.versionId !== undefined
        ? { versionId: revision.versionId }
        : {}),
    },
    sha256: destination.sha256,
    mode: plan.mode,
    ...(file.retained
      ? {
          retained: {
            rootArchiveId: file.retained.rootArchiveId,
            rootFileId: file.retained.rootFileId,
            relativeKey: file.retained.relativeKey,
            sourceArchiveId: file.retained.sourceArchiveId,
            sourceFileId: file.retained.sourceFileId,
            sourceDefinitionHash: file.retained.sourceDefinitionHash,
            sha256: file.retained.sha256,
          },
        }
      : {}),
    state: 'PREPARED',
  };
  return { ...definition, definitionHash: archiveHash(definition) };
}

export function assertSameMediaRegistration(
  stored: TransferredMediaRegistration,
  expected: TransferredMediaRegistration,
): void {
  // Ignore only persistence-owned Mongo fields; all registry data is immutable.
  const record = { ...stored } as TransferredMediaRegistration & {
    _id?: unknown;
    __v?: unknown;
  };
  delete record._id;
  delete record.__v;
  if (archiveHash(record) !== archiveHash(expected))
    throw new ConflictError(
      'The archive media registration already has different evidence',
    );
}

/** Builds a read-only retained reference from the final version matched in the write transaction. */
export function buildPublishedHistoryFinalMediaRegistration(
  archive: OwnershipArchive,
  manifest: ItemManifestDigestResult,
  file: ArchiveFile,
  {
    definition,
    permission,
    versionRecord,
  }: Required<PublishedHistoryFinalPutVersionContext>,
): PublishedHistoryFinalMediaRegistration {
  const intent = file.publishedHistoryFinalIntent;
  const retained = file.retained;
  const reservation = archive.reservation;
  const { observation, evidence } = versionRecord;
  const { scope, revision } = observation;
  if (
    !intent ||
    !retained?.publishedSource ||
    !reservation ||
    archive.state !== 'COPYING' ||
    file.state !== 'PENDING' ||
    file.archiveId !== archive.id ||
    intent.archiveId !== archive.id ||
    intent.fileId !== file.id ||
    intent.fileDefinitionHash !== file.definitionHash ||
    intent.reservationEpoch !== reservation.epoch ||
    intent.reservationBindingHash !== reservation.bindingHash ||
    retained.sourceArchiveId !== manifest.binding.observedSeal.archiveId ||
    retained.publishedSource.publicationHash !==
      archive.history?.sourcePublicationHash ||
    definition.intentDefinitionHash !== intent.definitionHash ||
    scope.permissionHash !== permission.permissionHash ||
    scope.authorizationId !== permission.authorizationId ||
    scope.target.key !== intent.destination.key ||
    scope.target.bucket !== intent.destination.bucket ||
    scope.target.expectedBucketOwner !==
      intent.destination.expectedBucketOwner ||
    scope.sha256 !== retained.sha256 ||
    !isPinnedItemSourceVersion(revision.versionId)
  )
    throw new ConflictError(
      'Published history final media registration evidence is inconsistent',
    );

  const protocol = PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL;
  const registration: Omit<
    PublishedHistoryFinalMediaRegistration,
    'definitionHash'
  > = {
    protocol,
    id: archiveHash([protocol, archive.id, file.id]),
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    intentDefinitionHash: intent.definitionHash,
    animalId: archive.animalId,
    fromOwnerId: archive.ownerId,
    recipientId: archive.recipientId,
    sourcePeriodId: archive.periodId,
    sourceOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    key: scope.target.key,
    revision: Object.freeze({ ...revision }),
    sha256: scope.sha256,
    mode: 'RETAINED_READ_ONLY',
    state: 'PREPARED',
    retained: Object.freeze({
      ...retained,
      publishedSource: Object.freeze({ ...retained.publishedSource }),
    }),
    publishedHistoryEvidence: Object.freeze({
      sourceManifestHash: manifest.manifestHash,
      reservationEpoch: reservation.epoch,
      reservationBindingHash: reservation.bindingHash,
      attemptDefinitionHash: definition.definitionHash,
      permissionHash: permission.permissionHash,
      versionObservationHash: observation.observationHash,
      conservationControlsHash: evidence.conservationControlsHash,
      requiredThrough: observation.requiredThrough,
      bucket: scope.target.bucket,
      expectedBucketOwner: scope.target.expectedBucketOwner,
    }),
  };
  return Object.freeze({
    ...registration,
    definitionHash: archiveHash(registration),
  });
}

/** Receives the matched final version from the transaction that owns the reservation. */
export function buildItemRecipientFinalMediaRegistration(
  archive: OwnershipArchive,
  manifest: ItemManifestDigestResult,
  file: ArchiveFile,
  {
    definition,
    permission,
    versionRecord,
  }: Required<ItemRecipientFinalPutVersionContext>,
): ItemRecipientFinalMediaRegistration {
  const intent = file.recipientFinalCopyIntent;
  const { observation, evidence } = versionRecord;
  const { scope, revision } = observation;
  const { fileId, fileDefinitionHash, ...binding } = definition.binding;
  if (
    !intent ||
    archive.state !== 'COPYING' ||
    file.archiveId !== archive.id ||
    file.retained !== undefined ||
    file.id !== fileId ||
    file.definitionHash !== fileDefinitionHash ||
    manifest.binding.observedSeal.archiveId !== archive.id ||
    manifest.binding.observedSeal.definitionHash !== archive.definitionHash ||
    manifest.manifestHash !== definition.manifestHash ||
    archiveHash(manifest.binding) !== archiveHash(binding) ||
    definition.copyIntentDefinitionHash !== intent.definitionHash ||
    permission.permissionHash !== scope.permissionHash ||
    permission.authorizationId !== scope.authorizationId ||
    scope.target.key !== intent.destination.key ||
    scope.target.bucket !== intent.bucket ||
    scope.sha256 !== intent.source.sha256 ||
    !isPinnedItemSourceVersion(revision.versionId)
  )
    throw new ConflictError(
      'Final media registration evidence is inconsistent',
    );
  const protocol = ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL;
  const registration: Omit<
    ItemRecipientFinalMediaRegistration,
    'definitionHash'
  > = {
    protocol,
    id: archiveHash([protocol, archive.id, fileId]),
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    fileId,
    fileDefinitionHash,
    intentDefinitionHash: intent.definitionHash,
    animalId: archive.animalId,
    fromOwnerId: archive.ownerId,
    recipientId: archive.recipientId,
    sourcePeriodId: archive.periodId,
    sourceOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    key: scope.target.key,
    revision: Object.freeze({
      etag: revision.etag,
      size: revision.size,
      versionId: revision.versionId,
    }),
    sha256: scope.sha256,
    mode: 'LIVE_RESOURCE',
    state: 'PREPARED',
    itemEvidence: Object.freeze({
      itemId: binding.itemId,
      manifestHash: manifest.manifestHash,
      observedSealHash: binding.observedSealHash,
      attemptDefinitionHash: definition.definitionHash,
      permissionHash: permission.permissionHash,
      versionObservationHash: observation.observationHash,
      conservationControlsHash: evidence.conservationControlsHash,
      requiredThrough: observation.requiredThrough,
    }),
  };
  return Object.freeze({
    ...registration,
    definitionHash: archiveHash(registration),
  });
}
