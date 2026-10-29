/** Versioned operational observations only. Never a write/dispatch/commit capability. */
export const PROMOTION_MONGO_REQUIREMENTS_VERSION =
  'MEDIA_PROMOTION_MONGO_REQUIREMENTS_V1';
type IndexRequirement = {
  id: string;
  key: Readonly<Record<string, 1 | -1>>;
  unique?: true;
  partialFilterExpression?: Readonly<Record<string, string>>;
};
type CollectionRequirement = {
  name: string;
  indexes: readonly IndexRequirement[];
};
export const PROMOTION_MONGO_REQUIREMENTS: readonly CollectionRequirement[] = [
  {
    name: 'animal_media_promotion_records',
    indexes: [
      { id: 'PROMOTION_ID', key: { id: 1 }, unique: true },
      { id: 'PROMOTION_IDENTITIES', key: { identityIds: 1 }, unique: true },
      { id: 'PROMOTION_PAGE', key: { operationId: 1, kind: 1, id: 1 } },
      {
        id: 'PROMOTION_UPLOAD',
        key: { operationId: 1, uploadId: 1 },
        unique: true,
        partialFilterExpression: { kind: 'EFFECT' },
      },
      {
        id: 'PROMOTION_DESTINATION',
        key: { operationId: 1, bucket: 1, destinationKey: 1 },
        unique: true,
        partialFilterExpression: { kind: 'EFFECT' },
      },
      {
        id: 'PROMOTION_ORDINAL',
        key: { effectId: 1, ordinal: 1 },
        unique: true,
        partialFilterExpression: { kind: 'ATTEMPT' },
      },
    ],
  },
  {
    name: 'animal_media_uploads',
    indexes: [
      { id: 'UPLOAD_ID', key: { id: 1 }, unique: true },
      { id: 'UPLOAD_FINAL', key: { finalKey: 1 }, unique: true },
      { id: 'UPLOAD_STAGING', key: { stagingKey: 1 }, unique: true },
    ],
  },
  {
    name: 'animal_write_journals',
    indexes: [
      { id: 'JOURNAL_ID', key: { id: 1 }, unique: true },
      { id: 'JOURNAL_INSTANCE', key: { instanceId: 1, lifecycle: 1 } },
    ],
  },
  {
    name: 'animal_ownership_controls',
    indexes: [
      { id: 'CONTROL_ANIMAL', key: { animalId: 1 }, unique: true },
      { id: 'CONTROL_OWNER', key: { ownerId: 1 } },
      { id: 'CONTROL_LOCK', key: { 'transferLock.transferId': 1 } },
    ],
  },
];
for (const collection of PROMOTION_MONGO_REQUIREMENTS) {
  for (const index of collection.indexes) {
    Object.freeze(index.key);
    if (index.partialFilterExpression)
      Object.freeze(index.partialFilterExpression);
    Object.freeze(index);
  }
  Object.freeze(collection.indexes);
  Object.freeze(collection);
}
Object.freeze(PROMOTION_MONGO_REQUIREMENTS);

export type PromotionMongoMetadata = {
  hello: {
    setName?: unknown;
    isWritablePrimary?: unknown;
    logicalSessionTimeoutMinutes?: unknown;
    msg?: unknown;
  };
  collections: Array<{
    name: string;
    type?: string;
    options?: Record<string, unknown>;
    indexes: Array<Record<string, unknown>>;
  }>;
};
type IssueCode =
  | 'TOPOLOGY_NOT_VALIDATED'
  | 'COLLECTION_MISSING'
  | 'COLLECTION_OPTIONS'
  | 'INDEX_MISSING'
  | 'INDEX_OPTIONS'
  | 'TTL_PRESENT'
  | 'UNREVIEWED_UNIQUE_INDEX';
export type PromotionMongoRequirementsReport = {
  version: typeof PROMOTION_MONGO_REQUIREMENTS_VERSION;
  observedAt: string;
  status: 'SATISFIED' | 'BLOCKED';
  transactions: 'NOT_PROBED';
  data: 'NOT_ASSESSED';
  activation: 'DISABLED';
  issues: Array<{
    code: IssueCode;
    collection?: string;
    requirementId?: string;
  }>;
};
function sameKey(actual: unknown, expected: IndexRequirement['key']): boolean {
  return (
    !!actual &&
    typeof actual === 'object' &&
    !Array.isArray(actual) &&
    JSON.stringify(Object.entries(actual)) ===
      JSON.stringify(Object.entries(expected))
  );
}
function canonical(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v))
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
      );
    return v;
  });
}
function simpleCollation(value: unknown): boolean {
  return (
    value === undefined ||
    (!!value &&
      typeof value === 'object' &&
      (value as { locale?: unknown }).locale === 'simple')
  );
}
function sameOptions(
  actual: Record<string, unknown>,
  expected: IndexRequirement,
): boolean {
  return (
    (actual.unique ?? false) === (expected.unique ?? false) &&
    (actual.sparse ?? false) === false &&
    (actual.hidden ?? false) === false &&
    actual.buildUUID === undefined &&
    actual.ready !== false &&
    (actual.prepareUnique ?? false) === false &&
    actual.expireAfterSeconds === undefined &&
    simpleCollation(actual.collation) &&
    canonical(actual.partialFilterExpression) ===
      canonical(expected.partialFilterExpression)
  );
}

export function assessPromotionMongoRequirements(
  metadata: PromotionMongoMetadata,
  observedAt: string,
): PromotionMongoRequirementsReport {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error('A valid observation timestamp is required');
  const issues: PromotionMongoRequirementsReport['issues'] = [];
  const hello = metadata.hello;
  if (
    typeof hello.setName !== 'string' ||
    !hello.setName ||
    hello.isWritablePrimary !== true ||
    typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
    !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
    hello.logicalSessionTimeoutMinutes <= 0 ||
    hello.msg !== undefined
  )
    issues.push({ code: 'TOPOLOGY_NOT_VALIDATED' });
  for (const requirement of PROMOTION_MONGO_REQUIREMENTS) {
    const matches = metadata.collections.filter(
      (c) => c.name === requirement.name,
    );
    if (!matches.length) {
      issues.push({ code: 'COLLECTION_MISSING', collection: requirement.name });
      continue;
    }
    const collection = matches[0],
      options = collection.options ?? {};
    if (
      matches.length !== 1 ||
      collection.type !== 'collection' ||
      options.capped === true ||
      options.timeseries !== undefined ||
      options.expireAfterSeconds !== undefined ||
      !simpleCollation(options.collation)
    )
      issues.push({ code: 'COLLECTION_OPTIONS', collection: requirement.name });
    if (collection.indexes.some((i) => i.expireAfterSeconds !== undefined))
      issues.push({ code: 'TTL_PRESENT', collection: requirement.name });
    for (const index of requirement.indexes) {
      const candidates = collection.indexes.filter((i) =>
        sameKey(i.key, index.key),
      );
      if (!candidates.some((i) => sameOptions(i, index)))
        issues.push({
          code: candidates.length ? 'INDEX_OPTIONS' : 'INDEX_MISSING',
          collection: requirement.name,
          requirementId: index.id,
        });
    }
    if (
      collection.indexes.some(
        (i) =>
          (i.unique === true || (i.prepareUnique ?? false) !== false) &&
          !sameKey(i.key, { _id: 1 }) &&
          !requirement.indexes.some(
            (required) =>
              sameKey(i.key, required.key) && sameOptions(i, required),
          ),
      )
    )
      issues.push({
        code: 'UNREVIEWED_UNIQUE_INDEX',
        collection: requirement.name,
      });
  }
  return {
    version: PROMOTION_MONGO_REQUIREMENTS_VERSION,
    observedAt,
    status: issues.length ? 'BLOCKED' : 'SATISFIED',
    transactions: 'NOT_PROBED',
    data: 'NOT_ASSESSED',
    activation: 'DISABLED',
    issues,
  };
}
