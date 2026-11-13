import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { archiveHash } from './ownership-archive';
import {
  ITEM_COPY_RECORD_PROTOCOL,
  type ItemCopyGateRecord,
  type ItemCopyRecord,
} from './transfer-item-copy-record';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import {
  PutDestinationWriterCoverage,
  PutDestinationWriters,
  putDestinationWriterCoverageValid,
  putDestinationWritersValid,
} from './transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import {
  PUBLISHED_HISTORY_STABLE_CUT_SCOPE_PROTOCOL,
  type PublishedHistoryStableCutScope,
} from './published-history-stable-cut-scope';
import type { ItemManifestDigestResult } from './transfer-item-manifest-digest';
import {
  ItemRecipientProjectionSelection,
  itemRecipientProjectionSelection,
} from './transfer-item-recipient-projection-selection';

const invalid = () =>
  new ConflictError(
    'The item stable-cut evidence does not match the selected projection',
  );

export const ITEM_STABLE_CUT_SCOPE_PROTOCOL =
  'ITEM_STABLE_CUT_SCOPE_V1' as const;

export type ItemStableCutCopyInventory = Readonly<{
  gate: Readonly<{
    id: string;
    recordHash: string;
    revision: number;
    state: ItemCopyGateRecord['state'];
  }> | null;
  attemptCount: number;
  permissionCount: number;
  attemptsDigest: string;
}>;

/** Local inventory only. The recorded permission is retained even if the gate was revoked. */
export function itemStableCutAttemptPin(
  raw: ItemCopyRecord,
  gate: ItemCopyGateRecord,
  expectedManifestHash: string,
) {
  if (
    raw?.row !== 'ATTEMPT' ||
    raw.protocol !== 'ITEM_COPY_RECORDS_V1' ||
    raw.gateId !== gate.id ||
    raw.state !== 'INTENDED' ||
    raw.ordinal !== 1 ||
    !profileIdValid(raw.id) ||
    !raw.definition?.binding
  )
    throw invalid();
  const { definitionHash, ...definition } = raw.definition;
  const { fileId, fileDefinitionHash, ...binding } = definition.binding;
  if (
    ![
      'ITEM_COPY_ATTEMPT_INTENT_V1',
      'ITEM_HISTORICAL_PUT_ATTEMPT_V1',
      'ITEM_HISTORICAL_PUT_ATTEMPT_V2',
      'ITEM_STAGING_PUT_ATTEMPT_V1',
      'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1',
    ].includes(definition.protocol) ||
    definition.id !== raw.id ||
    definition.ordinal !== raw.ordinal ||
    definition.origin !== 'INITIAL' ||
    definition.copyIntentId !== raw.copyIntentId ||
    ![definitionHash, fileId, fileDefinitionHash, raw.copyIntentId].every(
      sourceHashValid,
    ) ||
    archiveHash(definition) !== definitionHash ||
    archiveHash(binding) !== archiveHash(gate.binding) ||
    ('manifestHash' in definition &&
      definition.manifestHash !== expectedManifestHash)
  )
    throw invalid();
  const permission = 'permission' in raw ? raw.permission : undefined;
  if ('permission' in raw && !permission) throw invalid();
  if (permission) {
    const permissionProtocol = {
      ITEM_HISTORICAL_PUT_ATTEMPT_V2: 'ITEM_HISTORICAL_PUT_PERMISSION_V1',
      ITEM_STAGING_PUT_ATTEMPT_V1: 'ITEM_STAGING_PUT_PERMISSION_V1',
      ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1:
        'ITEM_RECIPIENT_FINAL_PUT_PERMISSION_V1',
      ITEM_COPY_ATTEMPT_INTENT_V1: undefined,
      ITEM_HISTORICAL_PUT_ATTEMPT_V1: undefined,
    }[definition.protocol];
    const { permissionHash, ...marker } = permission;
    if (
      permissionProtocol === undefined ||
      marker.protocol !== permissionProtocol ||
      marker.state !== 'MAY_RUN' ||
      marker.attemptId !== raw.id ||
      marker.attemptDefinitionHash !== definitionHash ||
      marker.dispatcherInstanceId !== definition.dispatcherInstanceId ||
      marker.gateId !== gate.id ||
      marker.gateDefinitionHash !== gate.definitionHash ||
      !profileIdValid(marker.authorizationId) ||
      marker.authorizationId === raw.id ||
      !Number.isSafeInteger(marker.gateRevision) ||
      marker.gateRevision < 1 ||
      marker.gateRevision !== marker.expectedGateRevision + 1 ||
      marker.gateRevision > gate.revision ||
      (gate.state === 'REVOKED' && marker.gateRevision === gate.revision) ||
      archiveHash(marker) !== permissionHash
    )
      throw invalid();
  }
  if (
    archiveHash(raw.identityIds) !==
    archiveHash(permission ? [raw.id, permission.authorizationId] : [raw.id])
  )
    throw invalid();
  return Object.freeze({
    attemptId: raw.id,
    definitionHash,
    ...(permission
      ? {
          permission: Object.freeze({
            authorizationId: permission.authorizationId,
            permissionHash: permission.permissionHash,
          }),
        }
      : {}),
  });
}

export function buildItemStableCutScope(
  selection: ItemRecipientProjectionSelection,
  copyInventory: ItemStableCutCopyInventory,
  retained: Readonly<{
    fileCount: number;
    versionsDigest: string;
    conservationControlsHashes: readonly string[];
  }>,
) {
  const scope = {
    protocol: ITEM_STABLE_CUT_SCOPE_PROTOCOL,
    selection: itemRecipientProjectionSelection(selection),
    copyInventory: Object.freeze({ ...copyInventory }),
    retained: Object.freeze({
      ...retained,
      conservationControlsHashes: Object.freeze([
        ...retained.conservationControlsHashes,
      ]),
    }),
  };
  return Object.freeze({ ...scope, scopeHash: archiveHash(scope) });
}

export type ItemStableCutScope = ReturnType<typeof buildItemStableCutScope>;
type StableCutAccreditation<Protocol extends string> = Readonly<{
  protocol: Protocol;
  issuerId: string;
  scopeHash: string;
  controlsHash: string;
  writerInventoryHash: string;
  writers: PutDestinationWriters;
  copyEffects: PutDestinationWriterCoverage;
  retainedVersionsEvidenceHash?: string;
  validFrom: string;
  validUntil: string;
}>;
export type ItemStableCutAccreditation =
  StableCutAccreditation<'ITEM_STABLE_CUT_ACCREDITATION_V1'>;
export type PublishedHistoryStableCutAccreditation =
  StableCutAccreditation<'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION_V1'>;

export function publishedHistoryStableCutAccreditationRecordId(
  scopeHash: string,
  accreditationHash: string,
) {
  return archiveHash([
    'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION_RECORD_V1',
    scopeHash,
    accreditationHash,
  ]);
}

export function buildPublishedHistoryStableCutAccreditationRecord(
  scope: PublishedHistoryStableCutScope,
  accreditation: PublishedHistoryStableCutAccreditation,
  accreditationHash: string,
  recordedAt: string,
) {
  const matched = matchPublishedHistoryStableCutAccreditation(
    scope,
    accreditation,
    accreditationHash,
    historicalPutEvidenceTime(recordedAt),
  );
  const id = publishedHistoryStableCutAccreditationRecordId(
    scope.scopeHash,
    accreditationHash,
  );
  const definition = {
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION' as const,
    state: 'RECORDED' as const,
    id,
    // Partition within the existing collection, separate from item copy gates.
    gateId: archiveHash([
      'PUBLISHED_HISTORY_STABLE_CUT_RECORDS_V1',
      scope.binding.archiveId,
    ]),
    identityIds: Object.freeze([id]),
    scope,
    accreditation,
    accreditationHash,
    recordedAt: matched.checkedAt,
  };
  return Object.freeze({
    ...definition,
    definitionHash: archiveHash(definition),
  });
}

export type PublishedHistoryStableCutAccreditationRecord = ReturnType<
  typeof buildPublishedHistoryStableCutAccreditationRecord
>;

export type ItemStableCutAccreditationSelection = Readonly<{
  selection: ItemRecipientProjectionSelection;
  expectedScopeHash: string;
  expectedAccreditationHash: string;
}>;

export function itemStableCutAccreditationSelection(
  raw: ItemStableCutAccreditationSelection,
): ItemStableCutAccreditationSelection {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !==
      'expectedAccreditationHash,expectedScopeHash,selection' ||
    ![raw.expectedScopeHash, raw.expectedAccreditationHash].every(
      sourceHashValid,
    )
  )
    throw new InvalidArgumentError(
      'Invalid item stable-cut accreditation selection',
    );
  return Object.freeze({
    selection: itemRecipientProjectionSelection(raw.selection),
    expectedScopeHash: raw.expectedScopeHash,
    expectedAccreditationHash: raw.expectedAccreditationHash,
  });
}

export function itemStableCutAccreditationRecordId(
  scopeHash: string,
  accreditationHash: string,
) {
  return archiveHash([
    'ITEM_STABLE_CUT_ACCREDITATION_RECORD_V1',
    scopeHash,
    accreditationHash,
  ]);
}

/** An immutable local record of a report already matched in the caller snapshot. */
export function buildItemStableCutAccreditationRecord(
  scope: ItemStableCutScope,
  accreditation: ItemStableCutAccreditation,
  gateId: string,
  accreditationHash: string,
  recordedAt: string,
) {
  const matched = matchItemStableCutAccreditation(
    scope,
    accreditation,
    accreditationHash,
    historicalPutEvidenceTime(recordedAt),
  );
  const id = itemStableCutAccreditationRecordId(
    scope.scopeHash,
    accreditationHash,
  );
  const definition = {
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'STABLE_CUT_ACCREDITATION' as const,
    state: 'RECORDED' as const,
    id,
    gateId,
    identityIds: Object.freeze([id]),
    scope,
    accreditation,
    accreditationHash: matched.accreditationHash,
    recordedAt: matched.checkedAt,
  };
  return Object.freeze({
    ...definition,
    definitionHash: archiveHash(definition),
  });
}

export type ItemStableCutAccreditationRecord = ReturnType<
  typeof buildItemStableCutAccreditationRecord
>;

/** The archive marker identifies the sole consumption for this item. */
export function buildItemStableCutConsumption(
  record: ItemStableCutAccreditationRecord,
  projection: Readonly<{
    binding: ItemManifestDigestResult['binding'];
    manifestHash: string;
    preparedCoverageHash: string;
    projectionHash: string;
  }>,
  consumedAt: string,
) {
  const {
    scope,
    id: accreditationId,
    definitionHash: accreditationDefinitionHash,
  } = record;
  const { selection } = scope;
  const { binding, manifestHash, preparedCoverageHash, projectionHash } =
    projection;
  const { selector } = selection;
  if (
    binding.transferId !== selector.transferId ||
    binding.itemId !== selector.itemId ||
    binding.requestVersion !== selector.expectedRequestVersion ||
    binding.observedSeal.captureRevision !== selector.expectedCaptureRevision ||
    binding.observedSealHash !== selection.expectedSealHash ||
    manifestHash !== selection.expectedManifestHash ||
    preparedCoverageHash !== selection.expectedPreparedCoverageHash ||
    projectionHash !== selection.expectedProjectionHash ||
    historicalPutEvidenceTime(consumedAt) <
      historicalPutEvidenceTime(record.recordedAt)
  )
    throw invalid();
  const protocol = 'ITEM_STABLE_CUT_CONSUMPTION_V1' as const;
  const { archiveId } = binding.observedSeal;
  const definition = {
    protocol,
    id: archiveHash([protocol, binding.transferId, binding.itemId, archiveId]),
    archiveId,
    binding,
    decisionOperationId: selector.decisionOperationId,
    manifestHash,
    preparedCoverageHash,
    projectionHash,
    scopeHash: scope.scopeHash,
    accreditationId,
    accreditationDefinitionHash,
    accreditationHash: record.accreditationHash,
    consumedAt,
  };
  return Object.freeze({
    ...definition,
    definitionHash: archiveHash(definition),
  });
}

export type ItemStableCutConsumption = ReturnType<
  typeof buildItemStableCutConsumption
>;

/** Trusted internal producer. The inventory includes prior deployments and their capabilities. */
export interface ItemStableCutAccreditationReader {
  readAccreditation(
    scope: ItemStableCutScope,
    expectedAccreditationHash: string,
  ): Promise<ItemStableCutAccreditation | null>;
}

/** Matches an independent report. A scope hash alone conveys no authority. */
export function matchItemStableCutAccreditation(
  scope: ItemStableCutScope,
  report: ItemStableCutAccreditation | null,
  expectedAccreditationHash: string,
  checkedAt: number,
) {
  return matchStableCutAccreditation(
    scope,
    ITEM_STABLE_CUT_SCOPE_PROTOCOL,
    scope?.selection?.requiredThrough,
    report,
    'ITEM_STABLE_CUT_ACCREDITATION_V1',
    expectedAccreditationHash,
    checkedAt,
  );
}

export interface PublishedHistoryStableCutAccreditationReader {
  readAccreditation(
    scope: PublishedHistoryStableCutScope,
    expectedAccreditationHash: string,
  ): Promise<PublishedHistoryStableCutAccreditation | null>;
}

export function matchPublishedHistoryStableCutAccreditation(
  scope: PublishedHistoryStableCutScope,
  report: PublishedHistoryStableCutAccreditation | null,
  expectedAccreditationHash: string,
  checkedAt: number,
) {
  return matchStableCutAccreditation(
    scope,
    PUBLISHED_HISTORY_STABLE_CUT_SCOPE_PROTOCOL,
    scope?.binding?.requiredThrough,
    report,
    'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION_V1',
    expectedAccreditationHash,
    checkedAt,
  );
}

function matchStableCutAccreditation(
  scope: ItemStableCutScope | PublishedHistoryStableCutScope,
  scopeProtocol: typeof scope.protocol,
  requiredThrough: string,
  report:
    | ItemStableCutAccreditation
    | PublishedHistoryStableCutAccreditation
    | null,
  reportProtocol: NonNullable<typeof report>['protocol'],
  expectedAccreditationHash: string,
  checkedAt: number,
) {
  if (!scope) throw invalid();
  const { scopeHash, ...facts } = scope;
  if (
    !report ||
    scope.protocol !== scopeProtocol ||
    !sourceHashValid(expectedAccreditationHash) ||
    archiveHash(facts) !== scopeHash
  )
    throw invalid();
  const horizon = historicalPutEvidenceTime(requiredThrough);
  const fields = [
    'protocol',
    'issuerId',
    'scopeHash',
    'controlsHash',
    'writerInventoryHash',
    'writers',
    'copyEffects',
    'validFrom',
    'validUntil',
    ...(scope.retained.fileCount > 0 ? ['retainedVersionsEvidenceHash'] : []),
  ];
  if (
    Object.keys(report).sort().join(',') !== fields.sort().join(',') ||
    report.protocol !== reportProtocol ||
    !profileIdValid(report.issuerId) ||
    report.scopeHash !== scopeHash ||
    ![report.controlsHash, report.writerInventoryHash].every(sourceHashValid) ||
    !putDestinationWritersValid(report.writers) ||
    !putDestinationWriterCoverageValid(report.copyEffects) ||
    (scope.retained.fileCount > 0
      ? !sourceHashValid(report.retainedVersionsEvidenceHash)
      : report.retainedVersionsEvidenceHash !== undefined) ||
    archiveHash(report) !== expectedAccreditationHash ||
    !Number.isSafeInteger(checkedAt) ||
    !(
      historicalPutEvidenceTime(report.validFrom) <= checkedAt &&
      checkedAt <= horizon &&
      horizon < historicalPutEvidenceTime(report.validUntil)
    )
  )
    throw invalid();
  return Object.freeze({
    scopeHash,
    accreditationHash: expectedAccreditationHash,
    controlsHash: report.controlsHash,
    checkedAt: new Date(checkedAt).toISOString(),
    assessment: 'ACCREDITATION_MATCHED' as const,
    stableCut: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  });
}
