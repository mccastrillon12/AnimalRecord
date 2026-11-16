/** Operational metadata only. Never permission to send, write business data or accept. */
export const FLOW_REQUIREMENTS_VERSION =
  'TRANSFER_FLOW_MONGO_REQUIREMENTS_V1' as const;
export type FlowIndex = Readonly<{
  id: string;
  key: Readonly<Record<string, 1 | -1>>;
  unique?: true;
  sparse?: true;
}>;
export type FlowCollection = Readonly<{
  name: string;
  management: 'SHARED' | 'OWNED';
  indexes: readonly FlowIndex[];
}>;
const index = (
  id: string,
  key: Record<string, 1 | -1>,
  unique?: true,
  sparse?: true,
): FlowIndex =>
  Object.freeze({
    id,
    key: Object.freeze(key),
    ...(unique ? { unique } : {}),
    ...(sparse ? { sparse } : {}),
  });
const collection = (
  name: string,
  management: FlowCollection['management'],
  indexes: FlowIndex[] = [],
): FlowCollection =>
  Object.freeze({
    name,
    management,
    indexes: Object.freeze([
      index(`${name}:IDENTITY`, { _id: 1 }, true),
      ...indexes,
    ]),
  });
export const FLOW_REQUIREMENTS: readonly FlowCollection[] = Object.freeze([
  collection('users', 'SHARED', [
    index('USER_ID', { id: 1 }, true),
    index('USER_IDENTIFICATION', { identificationNumber: 1 }, true),
    index('USER_EMAIL', { email: 1 }, true, true),
    index('USER_PHONE', { cellPhone: 1 }, true, true),
    index('USER_GOOGLE', { googleId: 1 }, undefined, true),
    index('USER_APPLE', { appleId: 1 }, undefined, true),
    index('USER_MICROSOFT', { microsoftId: 1 }, undefined, true),
  ]),
  collection('animals', 'SHARED', [
    index('ANIMAL_ID', { id: 1 }, true),
    index('ANIMAL_CODE', { code: 1 }, true),
  ]),
  collection('animal_ownership_controls', 'SHARED', [
    index('CONTROL_ANIMAL', { animalId: 1 }, true),
    index('CONTROL_OWNER', { ownerId: 1 }),
    index('CONTROL_LOCK', { 'transferLock.transferId': 1 }),
  ]),
  collection('animal_transfer_reasons', 'SHARED', [
    index('REASON_CODE', { code: 1 }, true),
  ]),
  collection('animal_transfer_otp', 'OWNED'),
  collection('animal_transfers', 'OWNED', [
    index('REQUEST_OUTGOING', { senderId: 1, createdAt: -1, _id: -1 }),
    index('REQUEST_INCOMING', { recipientId: 1, createdAt: -1, _id: -1 }),
  ]),
  collection('animal_transfer_items', 'OWNED', [
    index('REQUEST_ITEMS', { transferId: 1, animalId: 1 }),
  ]),
  collection('animal_transfer_active_items', 'OWNED', [
    index('REQUEST_CLAIMS', { transferId: 1 }),
  ]),
  collection('notifications', 'OWNED', [
    index('NOTICE_PAGE', { userId: 1, createdAt: -1, _id: -1 }),
    index('NOTICE_UNREAD', { userId: 1, readAt: 1 }),
  ]),
  collection('notification_outbox', 'OWNED', [
    index('OUTBOX_PAGE', { status: 1, createdAt: 1, _id: 1 }),
  ]),
  collection('animal_transfer_events', 'OWNED'),
  collection('notification_devices', 'OWNED', [
    index('DEVICE_USER', { userId: 1, state: 1 }),
  ]),
  collection('notification_device_tokens', 'OWNED'),
  collection('notification_push_deliveries', 'OWNED', [
    index('DELIVERY_READY', { state: 1, nextAttemptAt: 1, _id: 1 }),
  ]),
  collection('notification_push_attempts', 'OWNED', [
    index('ATTEMPT_ORDINAL', { deliveryId: 1, ordinal: 1 }, true),
  ]),
]);
export type FlowTarget = Readonly<{ databaseName: string; replicaSet: string }>;
export const copyFlowTarget = (target: FlowTarget): FlowTarget =>
  Object.freeze({
    databaseName: target?.databaseName,
    replicaSet: target?.replicaSet,
  });
export type FlowMetadata = {
  hello: {
    setName?: unknown;
    isWritablePrimary?: unknown;
    logicalSessionTimeoutMinutes?: unknown;
    msg?: unknown;
  };
  clientTimeoutMS?: unknown;
  collections: Array<{
    name: string;
    type?: string;
    options?: Record<string, unknown>;
    indexes: Array<Record<string, unknown>>;
  }>;
};
export type FlowIssueCode =
  | 'TOPOLOGY'
  | 'CLIENT_TIMEOUT'
  | 'COLLECTION_MISSING'
  | 'COLLECTION_OPTIONS'
  | 'INDEX_MISSING'
  | 'INDEX_OPTIONS'
  | 'TTL_PRESENT'
  | 'UNREVIEWED_UNIQUE_INDEX';
export type FlowIssue = {
  code: FlowIssueCode;
  collection?: string;
  indexId?: string;
};
export type FlowReport = Readonly<{
  version: typeof FLOW_REQUIREMENTS_VERSION;
  target: FlowTarget;
  observedAt: string;
  status: 'SATISFIED' | 'BLOCKED';
  transactions: 'NOT_PROBED';
  data: 'NOT_ASSESSED';
  activation: 'DISABLED';
  issues: readonly FlowIssue[];
}>;
export const flowIndexName = (id: string) => `ar_flow_v1_${id.toLowerCase()}`;
export const sameFlowKey = (a: unknown, b: FlowIndex['key']): boolean =>
  !!a &&
  typeof a === 'object' &&
  !Array.isArray(a) &&
  JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
const simple = (v: unknown) =>
  v === undefined ||
  (!!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v as { locale?: unknown }).locale === 'simple');
function indexOptions(actual: Record<string, unknown>, required: FlowIndex) {
  return (
    (sameFlowKey(required.key, { _id: 1 })
      ? actual.unique === undefined || actual.unique === true
      : (actual.unique ?? false) === (required.unique ?? false)) &&
    (actual.sparse ?? false) === (required.sparse ?? false) &&
    (actual.hidden ?? false) === false &&
    actual.buildUUID === undefined &&
    actual.ready !== false &&
    (actual.prepareUnique ?? false) === false &&
    actual.expireAfterSeconds === undefined &&
    actual.partialFilterExpression === undefined &&
    simple(actual.collation)
  );
}
export function assessTransferFlowMongo(
  metadata: FlowMetadata,
  target: FlowTarget,
  observedAt: string,
): FlowReport {
  if (
    !target.databaseName ||
    !target.replicaSet ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new Error('Invalid operational observation target/time');
  const issues: FlowIssue[] = [],
    hello = metadata.hello;
  if (
    hello.setName !== target.replicaSet ||
    !hello.setName ||
    hello.isWritablePrimary !== true ||
    typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
    !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
    hello.logicalSessionTimeoutMinutes <= 0 ||
    hello.msg !== undefined
  )
    issues.push({ code: 'TOPOLOGY' });
  // Driver 6.20 bulkWrite rejects inherited global CSOT inside bounded withTransaction.
  if (
    metadata.clientTimeoutMS !== undefined &&
    metadata.clientTimeoutMS !== null
  )
    issues.push({ code: 'CLIENT_TIMEOUT' });
  for (const required of FLOW_REQUIREMENTS) {
    const matches = metadata.collections.filter(
      (c) => c.name === required.name,
    );
    if (!matches.length) {
      issues.push({ code: 'COLLECTION_MISSING', collection: required.name });
      continue;
    }
    const current = matches[0],
      options = current.options ?? {};
    if (
      matches.length !== 1 ||
      current.type !== 'collection' ||
      options.capped === true ||
      options.timeseries !== undefined ||
      options.expireAfterSeconds !== undefined ||
      options.clusteredIndex !== undefined ||
      options.encryptedFields !== undefined ||
      !simple(options.collation) ||
      (options.validator !== undefined &&
        (!options.validator ||
          typeof options.validator !== 'object' ||
          Object.keys(options.validator).length !== 0))
    )
      issues.push({ code: 'COLLECTION_OPTIONS', collection: required.name });
    if (current.indexes.some((i) => i.expireAfterSeconds !== undefined))
      issues.push({ code: 'TTL_PRESENT', collection: required.name });
    for (const requiredIndex of required.indexes) {
      const candidates = current.indexes.filter((i) =>
        sameFlowKey(i.key, requiredIndex.key),
      );
      const nameConflict = current.indexes.some(
        (i) =>
          i.name === flowIndexName(requiredIndex.id) &&
          (!sameFlowKey(i.key, requiredIndex.key) ||
            !indexOptions(i, requiredIndex)),
      );
      if (
        nameConflict ||
        !candidates.some((i) => indexOptions(i, requiredIndex))
      )
        issues.push({
          code:
            candidates.length || nameConflict
              ? 'INDEX_OPTIONS'
              : 'INDEX_MISSING',
          collection: required.name,
          indexId: requiredIndex.id,
        });
    }
    if (
      current.indexes.some(
        (i) =>
          (i.unique === true || (i.prepareUnique ?? false) !== false) &&
          !required.indexes.some(
            (r) => sameFlowKey(i.key, r.key) && indexOptions(i, r),
          ),
      )
    )
      issues.push({
        code: 'UNREVIEWED_UNIQUE_INDEX',
        collection: required.name,
      });
  }
  return Object.freeze({
    version: FLOW_REQUIREMENTS_VERSION,
    target: copyFlowTarget(target),
    observedAt,
    status: issues.length ? 'BLOCKED' : 'SATISFIED',
    transactions: 'NOT_PROBED',
    data: 'NOT_ASSESSED',
    activation: 'DISABLED',
    issues: Object.freeze(issues.map((i) => Object.freeze(i))),
  });
}
