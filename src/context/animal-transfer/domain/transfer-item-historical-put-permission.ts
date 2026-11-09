import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyGateRecord,
  ItemHistoricalPutAttemptV2Record,
  buildItemCopyGateDefinition,
  captureItemCopyGate,
  nextCopyGateRevision,
} from './transfer-item-copy-record';
import {
  assertItemSourceProfileWindow,
  ItemSourceProfileRecord,
  matchActiveItemSourceProfile,
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import {
  evaluateHistoricalPutDestinationAdmission,
  ItemHistoricalPutDestinationAccreditation,
  matchItemHistoricalPutDestinationProtection,
  protectHistoricalPutDestinationFromAccreditation,
} from './transfer-item-historical-put-destination-protection';
import {
  captureItemSourceArtifactSeal,
  ItemSourceArtifactSeal,
} from './transfer-item-source-artifact';

type PermissionContext = Pick<
  ItemHistoricalPutAttemptV2Record,
  'definition' | 'gateId' | 'destinationProtection'
>;

type PermissionFacts = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  sourceControlsHash: string;
  admittedAt: string;
}>;

const invalid = () =>
  new ConflictError('The first historical PUT V2 permission is inconsistent');

/** The gate and attempt have already been reconstructed from their original reservation. */
function permissionRecord(
  gate: ItemCopyGateRecord,
  attempt: PermissionContext,
  facts: PermissionFacts,
) {
  const { definition, destinationProtection } = attempt;
  const { transferId, itemId, requestVersion, observedSeal, observedSealHash } =
    definition.binding;
  const originalGate = buildItemCopyGateDefinition({
    transferId,
    itemId,
    requestVersion,
    observedSeal,
    observedSealHash,
  });
  captureItemCopyGate(gate, originalGate);
  const {
    authorizationId,
    expectedGateRevision,
    transportRequestHash,
    sourceControlsHash,
    admittedAt,
  } = facts;
  if (!destinationProtection) throw invalid();
  const protection = matchItemHistoricalPutDestinationProtection(
    definition,
    destinationProtection,
    destinationProtection.protectionHash,
  );
  const { accreditationHash, controlsHash, validFrom, admitBefore } =
    protection;
  const at = Date.parse(admittedAt);
  if (
    attempt.gateId !== originalGate.id ||
    definition.origin !== 'INITIAL' ||
    definition.ordinal !== 1 ||
    !profileIdValid(authorizationId) ||
    authorizationId === definition.id ||
    authorizationId === definition.dispatcherInstanceId ||
    !sourceHashValid(accreditationHash) ||
    !sourceHashValid(transportRequestHash) ||
    !sourceHashValid(sourceControlsHash) ||
    !Number.isFinite(at) ||
    new Date(at).toISOString() !== admittedAt ||
    !(Date.parse(validFrom) <= at && at < Date.parse(admitBefore)) ||
    at < Date.parse(definition.artifact.observedAt)
  )
    throw invalid();

  const record = {
    protocol: 'ITEM_HISTORICAL_PUT_PERMISSION_V1' as const,
    state: 'MAY_RUN' as const,
    authorizationId,
    gateId: gate.id,
    gateDefinitionHash: gate.definitionHash,
    expectedGateRevision,
    gateRevision: nextCopyGateRevision(expectedGateRevision),
    attemptId: definition.id,
    attemptDefinitionHash: definition.definitionHash,
    dispatcherInstanceId: definition.dispatcherInstanceId,
    artifactHash: definition.artifact.artifactHash,
    transportRequestHash,
    protectionHash: protection.protectionHash,
    accreditationHash,
    sourceControlsHash,
    destinationControlsHash: controlsHash,
    admittedAt,
  };
  return Object.freeze({ ...record, permissionHash: archiveHash(record) });
}

export type ItemHistoricalPutPermission = ReturnType<typeof permissionRecord>;

export type ItemHistoricalPutPermissionInput = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  openedArtifactSeal: ItemSourceArtifactSeal;
  activeProfile: ItemSourceProfileRecord;
  accreditation: ItemHistoricalPutDestinationAccreditation;
  checkedAt: number;
}>;

/** Builds the proposed durable marker. Only a fresh, acknowledged commit can enable delegation. */
export function buildInitialHistoricalPutPermission(
  gate: ItemCopyGateRecord,
  attempt: ItemHistoricalPutAttemptV2Record,
  input: ItemHistoricalPutPermissionInput,
): ItemHistoricalPutPermission {
  const { definition, destinationProtection } = attempt;
  if (
    gate.state !== 'OPEN' ||
    gate.revision !== input.expectedGateRevision ||
    attempt.state !== 'INTENDED' ||
    !destinationProtection?.accreditationHash ||
    captureItemSourceArtifactSeal(input.openedArtifactSeal).artifactHash !==
      definition.artifact.artifactHash
  )
    throw invalid();
  const profile = matchActiveItemSourceProfile(
    input.activeProfile,
    definition.profile,
  );
  assertItemSourceProfileWindow(profile, input.checkedAt);
  const expected = protectHistoricalPutDestinationFromAccreditation(
    definition,
    destinationProtection.controlsHash,
    destinationProtection.accreditationHash,
    input.accreditation,
  );
  const admission = evaluateHistoricalPutDestinationAdmission(
    destinationProtection,
    expected,
    input.checkedAt,
  );
  return permissionRecord(gate, attempt, {
    authorizationId: input.authorizationId,
    expectedGateRevision: input.expectedGateRevision,
    transportRequestHash: input.transportRequestHash,
    sourceControlsHash: profile.controlsHash,
    admittedAt: admission.checkedAt,
  });
}

/** Historical comparison only. A later gate revision or revocation preserves MAY_RUN. */
export function observeInitialHistoricalPutPermission(
  gate: ItemCopyGateRecord,
  attempt: PermissionContext,
  stored: ItemHistoricalPutPermission,
  expectedAuthorizationId: string,
) {
  if (!stored) throw invalid();
  const permission = permissionRecord(gate, attempt, stored);
  if (
    permission.authorizationId !== expectedAuthorizationId ||
    gate.revision < permission.gateRevision ||
    (gate.state === 'REVOKED' && gate.revision === permission.gateRevision) ||
    !isDeepStrictEqual(stored, permission)
  )
    throw invalid();
  return Object.freeze({
    permission,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  });
}
