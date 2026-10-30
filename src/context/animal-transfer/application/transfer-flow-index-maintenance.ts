import { createHash } from 'node:crypto';
import {
  FLOW_REQUIREMENTS,
  FLOW_REQUIREMENTS_VERSION,
  FlowReport,
  FlowTarget,
  flowIndexName,
  copyFlowTarget,
} from '../domain/transfer-flow-mongo-requirements';

export const FLOW_PLAN_VERSION = 'TRANSFER_FLOW_INDEX_PLAN_V1' as const;
export type FlowIndexAction = Readonly<{
  type: 'CREATE_COLLECTION' | 'CREATE_INDEX';
  id: string;
  collection: string;
}>;
export type FlowIndexPlan = Readonly<{
  version: typeof FLOW_PLAN_VERSION;
  requirementsVersion: typeof FLOW_REQUIREMENTS_VERSION;
  target: FlowTarget;
  planId: string;
  status: 'READY' | 'NO_CHANGES' | 'BLOCKED';
  actions: readonly FlowIndexAction[];
  report: FlowReport;
}>;
export interface FlowMaintenancePort {
  inspect(): Promise<FlowReport>;
  create(action: FlowIndexAction): Promise<void>;
}
export class FlowMaintenanceError extends Error {
  readonly name = 'FlowMaintenanceError';
  readonly acknowledgedActionIds: readonly string[];
  constructor(
    readonly stage: 'INPUT' | 'INSPECT' | 'REVIEW' | 'APPLY' | 'LIFECYCLE',
    readonly reason:
      | 'INVALID'
      | 'UNAVAILABLE'
      | 'CHANGED'
      | 'BLOCKED'
      | 'UNCERTAIN',
    acknowledged: readonly string[] = [],
    readonly actionId?: string,
  ) {
    super(`Transfer flow index maintenance stopped at ${stage}: ${reason}`);
    this.acknowledgedActionIds = Object.freeze([...acknowledged]);
  }
}
export function validFlowTarget(target: FlowTarget): boolean {
  return (
    !!target &&
    typeof target.databaseName === 'string' &&
    !!target.databaseName &&
    target.databaseName.trim() === target.databaseName &&
    Buffer.byteLength(target.databaseName) <= 63 &&
    !/[\0/\\.\s"$]/.test(target.databaseName) &&
    typeof target.replicaSet === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(target.replicaSet)
  );
}
export function flowPlan(target: FlowTarget, raw: FlowReport): FlowIndexPlan {
  if (!validFlowTarget(target)) throw new Error('Invalid flow target');
  const copied = structuredClone(raw);
  const verifiedIssues = copied.issues;
  if (
    Object.keys(copied).sort().join(',') !==
      'activation,data,issues,observedAt,status,target,transactions,version' ||
    copied.version !== FLOW_REQUIREMENTS_VERSION ||
    copied.target.databaseName !== target.databaseName ||
    copied.target.replicaSet !== target.replicaSet ||
    !['SATISFIED', 'BLOCKED'].includes(copied.status) ||
    !Number.isFinite(Date.parse(copied.observedAt)) ||
    copied.transactions !== 'NOT_PROBED' ||
    copied.data !== 'NOT_ASSESSED' ||
    copied.activation !== 'DISABLED' ||
    !Array.isArray(copied.issues) ||
    (copied.status === 'SATISFIED') !== (copied.issues.length === 0)
  )
    throw new Error('Invalid flow requirements report');
  if (
    verifiedIssues.some(
      (i) =>
        Object.keys(i).some(
          (key) => !['code', 'collection', 'indexId'].includes(key),
        ) ||
        ![
          'TOPOLOGY',
          'CLIENT_TIMEOUT',
          'COLLECTION_MISSING',
          'COLLECTION_OPTIONS',
          'INDEX_MISSING',
          'INDEX_OPTIONS',
          'TTL_PRESENT',
          'UNREVIEWED_UNIQUE_INDEX',
        ].includes(i.code) ||
        (i.collection !== undefined && typeof i.collection !== 'string') ||
        (i.indexId !== undefined && typeof i.indexId !== 'string'),
    )
  )
    throw new Error('Invalid operational issue projection');
  const report: FlowReport = Object.freeze({
    ...copied,
    target: copyFlowTarget(copied.target),
    issues: Object.freeze(verifiedIssues.map((i) => Object.freeze({ ...i }))),
  });
  const blocked = report.issues.some((issue) => {
    const c = FLOW_REQUIREMENTS.find((r) => r.name === issue.collection);
    return (
      !c ||
      c.management !== 'OWNED' ||
      !(
        (issue.code === 'COLLECTION_MISSING' && issue.indexId === undefined) ||
        (issue.code === 'INDEX_MISSING' &&
          c.indexes.some(
            (i) =>
              i.id === issue.indexId && Object.keys(i.key).join(',') !== '_id',
          ))
      )
    );
  });
  const actions: FlowIndexAction[] = [];
  if (!blocked)
    for (const c of FLOW_REQUIREMENTS.filter((r) => r.management === 'OWNED')) {
      const missing = report.issues.some(
        (i) => i.code === 'COLLECTION_MISSING' && i.collection === c.name,
      );
      if (missing)
        actions.push(
          Object.freeze({
            type: 'CREATE_COLLECTION',
            id: `COLLECTION:${c.name}`,
            collection: c.name,
          }),
        );
      for (const i of c.indexes)
        if (
          Object.keys(i.key).join(',') !== '_id' &&
          (missing ||
            report.issues.some(
              (issue) =>
                issue.code === 'INDEX_MISSING' &&
                issue.collection === c.name &&
                issue.indexId === i.id,
            ))
        )
          actions.push(
            Object.freeze({
              type: 'CREATE_INDEX',
              id: i.id,
              collection: c.name,
            }),
          );
    }
  const status = blocked ? 'BLOCKED' : actions.length ? 'READY' : 'NO_CHANGES';
  const frozenTarget = copyFlowTarget(target);
  const planId = createHash('sha256')
    .update(
      JSON.stringify({
        version: FLOW_PLAN_VERSION,
        requirementsVersion: FLOW_REQUIREMENTS_VERSION,
        target: frozenTarget,
        status,
        actions,
        manifest: FLOW_REQUIREMENTS,
        blockers: report.issues
          .map((i) => [i.code, i.collection ?? '', i.indexId ?? ''].join(':'))
          .sort(),
      }),
    )
    .digest('hex');
  return Object.freeze({
    version: FLOW_PLAN_VERSION,
    requirementsVersion: FLOW_REQUIREMENTS_VERSION,
    target: frozenTarget,
    planId,
    status,
    actions: Object.freeze(actions),
    report,
  });
}
/** Internal explicit operator. No connection, startup registration, retries or activation. */
export class TransferFlowIndexMaintenance {
  private used = false;
  private readonly target: FlowTarget;
  constructor(
    private readonly port: FlowMaintenancePort,
    target: FlowTarget,
  ) {
    this.target = copyFlowTarget(target);
  }
  private async plan(acknowledged: readonly string[] = []) {
    if (!validFlowTarget(this.target))
      throw new FlowMaintenanceError('INPUT', 'INVALID', acknowledged);
    try {
      return flowPlan(this.target, await this.port.inspect());
    } catch {
      throw new FlowMaintenanceError('INSPECT', 'UNAVAILABLE', acknowledged);
    }
  }
  prepare() {
    return this.plan();
  }
  async apply(raw: FlowTarget & { reviewedPlanId: string }): Promise<{
    planId: string;
    acknowledgedActionIds: readonly string[];
    report: FlowReport;
  }> {
    if (this.used) throw new FlowMaintenanceError('LIFECYCLE', 'INVALID');
    this.used = true;
    const id = raw?.reviewedPlanId;
    if (
      !raw ||
      Object.keys(raw).sort().join(',') !==
        'databaseName,replicaSet,reviewedPlanId' ||
      raw.databaseName !== this.target.databaseName ||
      raw.replicaSet !== this.target.replicaSet ||
      !/^[a-f0-9]{64}$/.test(id ?? '')
    )
      throw new FlowMaintenanceError('INPUT', 'INVALID');
    const original = await this.plan();
    if (original.planId !== id)
      throw new FlowMaintenanceError('REVIEW', 'CHANGED');
    if (original.status === 'BLOCKED')
      throw new FlowMaintenanceError('REVIEW', 'BLOCKED');
    const acknowledged: string[] = [];
    for (let i = 0; i < original.actions.length; i++) {
      const current = i === 0 ? original : await this.plan(acknowledged);
      if (
        current.status === 'BLOCKED' ||
        JSON.stringify(current.actions) !==
          JSON.stringify(original.actions.slice(i))
      )
        throw new FlowMaintenanceError('REVIEW', 'CHANGED', acknowledged);
      const action = original.actions[i];
      try {
        await this.port.create(action);
      } catch {
        throw new FlowMaintenanceError(
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
      throw new FlowMaintenanceError('REVIEW', 'CHANGED', acknowledged);
    return {
      planId: id,
      acknowledgedActionIds: Object.freeze([...acknowledged]),
      report: final.report,
    };
  }
}

/** Decode only fixed manifest identities; no caller-supplied Mongo keys/options. */
export function flowActionDefinition(raw: FlowIndexAction) {
  const c = FLOW_REQUIREMENTS.find((r) => r.name === raw?.collection);
  if (
    !c ||
    c.management !== 'OWNED' ||
    Object.keys(raw).sort().join(',') !== 'collection,id,type'
  )
    throw new Error('Invalid flow action');
  if (raw.type === 'CREATE_COLLECTION' && raw.id === `COLLECTION:${c.name}`)
    return { collection: c.name };
  const i = c.indexes.find(
    (i) => i.id === raw.id && Object.keys(i.key).join(',') !== '_id',
  );
  if (!i || raw.type !== 'CREATE_INDEX')
    throw new Error('Invalid flow index action');
  return { collection: c.name, index: i, name: flowIndexName(i.id) };
}
