import { createHash } from 'node:crypto';
import {
  PROMOTION_MONGO_REQUIREMENTS,
  PROMOTION_MONGO_REQUIREMENTS_VERSION,
  PromotionMongoRequirementsReport,
} from '../domain/media-promotion-mongo-requirements';

export const PROMOTION_INDEX_PLAN_VERSION = 'MEDIA_PROMOTION_INDEX_PLAN_V1';
export type PromotionIndexAction = Readonly<{
  id: string;
  collection: string;
  type: 'CREATE_COLLECTION' | 'CREATE_INDEX';
  key?: Readonly<Record<string, 1 | -1>>;
  options?: Readonly<{
    name: string;
    unique?: true;
    partialFilterExpression?: Readonly<Record<string, string>>;
  }>;
}>;
export type PromotionIndexPlan = Readonly<{
  version: typeof PROMOTION_INDEX_PLAN_VERSION;
  requirementsVersion: typeof PROMOTION_MONGO_REQUIREMENTS_VERSION;
  databaseName: string;
  planId: string;
  status: 'READY' | 'NO_CHANGES' | 'BLOCKED';
  actions: readonly PromotionIndexAction[];
  report: PromotionMongoRequirementsReport;
}>;
/** Trusted operational backend port, separate from business persistence/callers. */
export interface PromotionIndexMaintenancePort {
  inspect(): Promise<PromotionMongoRequirementsReport>;
  create(action: PromotionIndexAction): Promise<void>;
}
export class PromotionIndexMaintenanceError extends Error {
  readonly name = 'PromotionIndexMaintenanceError';
  readonly acknowledgedActionIds: readonly string[];
  constructor(
    readonly stage: 'INPUT' | 'LIFECYCLE' | 'INSPECT' | 'REVIEW' | 'APPLY',
    readonly reason:
      | 'INVALID'
      | 'UNAVAILABLE'
      | 'CHANGED'
      | 'BLOCKED'
      | 'UNCERTAIN',
    acknowledged: readonly string[] = [],
    readonly actionId?: string,
  ) {
    super(`Promotion index maintenance stopped at ${stage}: ${reason}`);
    this.acknowledgedActionIds = Object.freeze([...acknowledged]);
  }
}
function makePlan(
  databaseName: string,
  raw: PromotionMongoRequirementsReport,
): PromotionIndexPlan {
  const report = structuredClone(raw);
  if (
    report.version !== PROMOTION_MONGO_REQUIREMENTS_VERSION ||
    !['SATISFIED', 'BLOCKED'].includes(report.status) ||
    !Number.isFinite(Date.parse(report.observedAt)) ||
    report.transactions !== 'NOT_PROBED' ||
    report.data !== 'NOT_ASSESSED' ||
    report.activation !== 'DISABLED' ||
    !Array.isArray(report.issues) ||
    (report.status === 'SATISFIED') !== (report.issues.length === 0)
  )
    throw new Error('Invalid prerequisites report');
  const actions: PromotionIndexAction[] = [];
  let blocked = false;
  for (const issue of report.issues) {
    const collection = PROMOTION_MONGO_REQUIREMENTS.find(
      (c) => c.name === issue.collection,
    );
    if (
      issue.code === 'COLLECTION_MISSING' &&
      collection &&
      issue.requirementId === undefined
    )
      continue;
    if (
      issue.code === 'INDEX_MISSING' &&
      collection?.indexes.some((i) => i.id === issue.requirementId)
    )
      continue;
    blocked = true;
  }
  if (!blocked)
    for (const collection of PROMOTION_MONGO_REQUIREMENTS) {
      const missing = report.issues.some(
        (i) =>
          i.code === 'COLLECTION_MISSING' && i.collection === collection.name,
      );
      if (missing)
        actions.push(
          Object.freeze({
            id: `COLLECTION:${collection.name}`,
            collection: collection.name,
            type: 'CREATE_COLLECTION',
          }),
        );
      for (const index of collection.indexes) {
        if (
          !missing &&
          !report.issues.some(
            (i) =>
              i.code === 'INDEX_MISSING' &&
              i.collection === collection.name &&
              i.requirementId === index.id,
          )
        )
          continue;
        actions.push(
          Object.freeze({
            id: index.id,
            collection: collection.name,
            type: 'CREATE_INDEX',
            key: index.key,
            options: Object.freeze({
              name: `ar_promotion_v1_${index.id.toLowerCase()}`,
              ...(index.unique ? { unique: true as const } : {}),
              ...(index.partialFilterExpression
                ? { partialFilterExpression: index.partialFilterExpression }
                : {}),
            }),
          }),
        );
      }
    }
  const status = blocked ? 'BLOCKED' : actions.length ? 'READY' : 'NO_CHANGES';
  const blockers = report.issues
    .map((i) => [i.code, i.collection ?? '', i.requirementId ?? ''].join(':'))
    .sort();
  const planId = createHash('sha256')
    .update(
      JSON.stringify({
        version: PROMOTION_INDEX_PLAN_VERSION,
        requirementsVersion: report.version,
        databaseName,
        status,
        actions,
        blockers,
      }),
    )
    .digest('hex');
  return Object.freeze({
    version: PROMOTION_INDEX_PLAN_VERSION,
    requirementsVersion: report.version,
    databaseName,
    planId,
    status,
    actions: Object.freeze(actions),
    report,
  });
}

/** One apply per instance. No automatic retry, data repair, rollback or activation. */
export class MediaPromotionIndexMaintenance {
  private used = false;
  constructor(
    private readonly port: PromotionIndexMaintenancePort,
    private readonly databaseName: string,
  ) {}

  private async plan(
    acknowledged: readonly string[] = [],
  ): Promise<PromotionIndexPlan> {
    if (typeof this.databaseName !== 'string' || !this.databaseName)
      throw new PromotionIndexMaintenanceError(
        'INPUT',
        'INVALID',
        acknowledged,
      );
    try {
      return makePlan(this.databaseName, await this.port.inspect());
    } catch {
      throw new PromotionIndexMaintenanceError(
        'INSPECT',
        'UNAVAILABLE',
        acknowledged,
      );
    }
  }
  prepare(): Promise<PromotionIndexPlan> {
    return this.plan();
  }

  async apply(raw: { databaseName: string; reviewedPlanId: string }): Promise<{
    planId: string;
    acknowledgedActionIds: readonly string[];
    report: PromotionMongoRequirementsReport;
  }> {
    if (this.used)
      throw new PromotionIndexMaintenanceError('LIFECYCLE', 'INVALID');
    this.used = true;
    const databaseName = raw?.databaseName,
      reviewedPlanId = raw?.reviewedPlanId;
    if (
      databaseName !== this.databaseName ||
      !/^[a-f0-9]{64}$/.test(reviewedPlanId ?? '')
    )
      throw new PromotionIndexMaintenanceError('INPUT', 'INVALID');
    const original = await this.plan();
    if (original.planId !== reviewedPlanId)
      throw new PromotionIndexMaintenanceError('REVIEW', 'CHANGED');
    if (original.status === 'BLOCKED')
      throw new PromotionIndexMaintenanceError('REVIEW', 'BLOCKED');
    const acknowledged: string[] = [];
    let current = original;
    for (let i = 0; i < original.actions.length; i++) {
      if (i > 0) current = await this.plan(acknowledged);
      if (
        current.status === 'BLOCKED' ||
        JSON.stringify(current.actions) !==
          JSON.stringify(original.actions.slice(i))
      )
        throw new PromotionIndexMaintenanceError(
          'REVIEW',
          'CHANGED',
          acknowledged,
        );
      const action = original.actions[i];
      try {
        await this.port.create(action);
      } catch {
        throw new PromotionIndexMaintenanceError(
          'APPLY',
          'UNCERTAIN',
          acknowledged,
          action.id,
        );
      }
      acknowledged.push(action.id);
    }
    const final = await this.plan(acknowledged);
    if (final.status !== 'NO_CHANGES')
      throw new PromotionIndexMaintenanceError(
        'REVIEW',
        'CHANGED',
        acknowledged,
      );
    return {
      planId: reviewedPlanId,
      acknowledgedActionIds: Object.freeze([...acknowledged]),
      report: final.report,
    };
  }
}
