import { createHash } from 'node:crypto';
import {
  FlowIndexPlan,
  FlowMaintenanceError,
  TransferFlowIndexMaintenance,
  flowPlan,
  validFlowTarget,
} from '../context/animal-transfer/application/transfer-flow-index-maintenance';
import {
  FlowTarget,
  copyFlowTarget,
} from '../context/animal-transfer/domain/transfer-flow-mongo-requirements';

export const FLOW_REVIEW_VERSION = 'TRANSFER_FLOW_REVIEW_V1' as const;
export const FLOW_OPERATION_VERSION = 'TRANSFER_FLOW_OPERATION_V1' as const;
export const FLOW_OPERATION_URI = 'TRANSFER_FLOW_OPERATION_MONGO_URI';
export const FLOW_REVIEW_MAX_BYTES = 1024 * 1024;
export type FlowDeployment = Readonly<{
  protocol: 'mongodb' | 'mongodb+srv';
  hosts: readonly string[];
  tls: boolean;
  directConnection: boolean;
}>;
export type FlowReview = Readonly<{
  version: typeof FLOW_REVIEW_VERSION;
  deployment: FlowDeployment;
  plan: FlowIndexPlan;
  reviewId: string;
}>;
export type FlowCommand = {
  mode: 'prepare' | 'apply';
  target: FlowTarget;
  reviewFile?: string;
  reviewId?: string;
};
export interface FlowOperationConnection {
  readonly deployment: FlowDeployment;
  open(): Promise<Pick<TransferFlowIndexMaintenance, 'prepare' | 'apply'>>;
  close(): Promise<void>;
}
export interface FlowOperationPorts {
  connection(uri: string, target: FlowTarget): FlowOperationConnection;
  readReview(path: string): Promise<string>;
}
export class FlowOperationInputError extends Error {
  readonly name = 'FlowOperationInputError';
  constructor(
    readonly reason:
      | 'ARGUMENTS'
      | 'URI'
      | 'REVIEW_FILE'
      | 'REVIEW'
      | 'DEPLOYMENT',
  ) {
    super(`Invalid transfer flow operation input: ${reason}`);
  }
}
const invalid = () => new FlowOperationInputError('ARGUMENTS');
export const flowOperationHelp = {
  version: FLOW_OPERATION_VERSION,
  mode: 'HELP',
  usage: [
    'prepare --database-name NAME --replica-set RS',
    'apply --database-name NAME --replica-set RS --review-file FILE --review-id SHA256 --execute',
  ],
  uriEnvironment: FLOW_OPERATION_URI,
  notes: [
    'Build first; use npm run --silent ops:transfer-flow -- ... for JSON redirection.',
    'No .env/AppModule, application URI fallback, seeders or startup changes.',
    'Preparation reads Mongo metadata. Apply can issue additive DDL and needs environment-specific authorization.',
    'A reviewed hash does not authenticate an operator or authorize business writes/acceptance/push.',
  ],
};
export function parseFlowCommand(args: readonly string[]): FlowCommand | null {
  if (args.length === 1 && (args[0] === '--help' || args[0] === 'help'))
    return null;
  if (!['prepare', 'apply'].includes(args[0]) || args.length > 12)
    throw invalid();
  const mode = args[0] as FlowCommand['mode'],
    values = new Map<string, string>();
  let execute = false;
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (key === '--execute') {
      if (execute) throw invalid();
      execute = true;
      continue;
    }
    if (
      ![
        '--database-name',
        '--replica-set',
        '--review-file',
        '--review-id',
      ].includes(key) ||
      values.has(key)
    )
      throw invalid();
    const value = args[++i];
    if (!value || value.startsWith('--') || value.length > 4096)
      throw invalid();
    values.set(key, value);
  }
  const target = copyFlowTarget({
    databaseName: values.get('--database-name')!,
    replicaSet: values.get('--replica-set')!,
  });
  if (!validFlowTarget(target)) throw invalid();
  if (mode === 'prepare') {
    if (execute || values.has('--review-file') || values.has('--review-id'))
      throw invalid();
    return { mode, target };
  }
  const reviewFile = values.get('--review-file'),
    reviewId = values.get('--review-id');
  if (!execute || !reviewFile || !/^[a-f0-9]{64}$/.test(reviewId ?? ''))
    throw invalid();
  return { mode, target, reviewFile, reviewId };
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
function deploymentCopy(raw: FlowDeployment): FlowDeployment {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !==
      'directConnection,hosts,protocol,tls' ||
    !['mongodb', 'mongodb+srv'].includes(raw.protocol) ||
    typeof raw.tls !== 'boolean' ||
    typeof raw.directConnection !== 'boolean' ||
    !Array.isArray(raw.hosts) ||
    !raw.hosts.length ||
    raw.hosts.length > 20 ||
    raw.hosts.some(
      (h) =>
        typeof h !== 'string' || !h || h.length > 300 || /[\s@/?#]/.test(h),
    )
  )
    throw new FlowOperationInputError('DEPLOYMENT');
  return Object.freeze({
    protocol: raw.protocol,
    hosts: Object.freeze([...new Set(raw.hosts)].sort()),
    tls: raw.tls,
    directConnection: raw.directConnection,
  });
}
export function makeFlowReview(
  plan: FlowIndexPlan,
  deployment: FlowDeployment,
): FlowReview {
  const body = {
    version: FLOW_REVIEW_VERSION,
    deployment: deploymentCopy(deployment),
    plan,
  };
  return Object.freeze({
    ...body,
    reviewId: createHash('sha256').update(canonical(body)).digest('hex'),
  });
}
function readFlowReview(text: string, command: FlowCommand): FlowReview {
  try {
    if (
      typeof text !== 'string' ||
      Buffer.byteLength(text) > FLOW_REVIEW_MAX_BYTES
    )
      throw new Error();
    const raw = JSON.parse(text) as FlowReview;
    const reconstructed = makeFlowReview(
      flowPlan(command.target, raw.plan.report),
      raw.deployment,
    );
    if (
      raw.reviewId !== command.reviewId ||
      canonical(raw) !== canonical(reconstructed)
    )
      throw new Error();
    return reconstructed;
  } catch {
    throw new FlowOperationInputError('REVIEW');
  }
}
export type FlowOperationOutput = Record<string, unknown> | FlowReview;
export async function runFlowOperation(
  args: readonly string[],
  env: Readonly<{ TRANSFER_FLOW_OPERATION_MONGO_URI?: string }>,
  ports: FlowOperationPorts,
): Promise<{ exitCode: number; output: FlowOperationOutput }> {
  let connection: FlowOperationConnection | undefined,
    command: FlowCommand | undefined;
  let stage = 'INPUT',
    exitCode = 0,
    output: FlowOperationOutput = {};
  try {
    const parsed = parseFlowCommand([...args]);
    if (!parsed) return { exitCode: 0, output: flowOperationHelp };
    command = parsed;
    const uri = env.TRANSFER_FLOW_OPERATION_MONGO_URI;
    if (
      typeof uri !== 'string' ||
      !uri ||
      uri.trim() !== uri ||
      uri.length > 16384 ||
      /[\r\n\0]/.test(uri)
    )
      throw new FlowOperationInputError('URI');
    let review: FlowReview | undefined;
    if (command.mode === 'apply') {
      let text: string;
      try {
        text = await ports.readReview(command.reviewFile!);
      } catch {
        throw new FlowOperationInputError('REVIEW_FILE');
      }
      review = readFlowReview(text, command);
    }
    connection = ports.connection(uri, command.target);
    const deployment = deploymentCopy(connection.deployment);
    if (review && canonical(deployment) !== canonical(review.deployment))
      throw new FlowOperationInputError('DEPLOYMENT');
    stage = 'CONNECT';
    const operator = await connection.open();
    stage = 'OPERATION';
    if (command.mode === 'prepare') {
      const plan = await operator.prepare();
      output = makeFlowReview(plan, deployment);
      exitCode = plan.status === 'BLOCKED' ? 3 : 0;
    } else {
      const result = await operator.apply({
        ...command.target,
        reviewedPlanId: review!.plan.planId,
      });
      output = {
        version: FLOW_OPERATION_VERSION,
        mode: 'APPLY',
        status: 'ACKNOWLEDGED',
        target: command.target,
        deployment,
        reviewId: review!.reviewId,
        planId: result.planId,
        acknowledgedActionIds: result.acknowledgedActionIds,
        report: result.report,
        connectionClosed: true,
      };
    }
  } catch (error) {
    let reason = 'UNAVAILABLE',
      acknowledgedActionIds: readonly string[] = [],
      actionId: string | undefined;
    let ddlMayHaveRun = command?.mode === 'apply' && stage === 'OPERATION';
    if (error instanceof FlowOperationInputError) {
      stage = 'INPUT';
      reason = error.reason;
      exitCode = 2;
      ddlMayHaveRun = false;
    } else if (error instanceof FlowMaintenanceError) {
      stage = error.stage;
      reason = error.reason;
      acknowledgedActionIds = error.acknowledgedActionIds;
      actionId = error.actionId;
      ddlMayHaveRun =
        command?.mode === 'apply' &&
        (error.stage === 'APPLY' || acknowledgedActionIds.length > 0);
      exitCode = ['BLOCKED', 'CHANGED'].includes(error.reason)
        ? 3
        : error.reason === 'UNCERTAIN'
          ? 4
          : ['INPUT', 'LIFECYCLE'].includes(error.stage)
            ? 2
            : 5;
    } else {
      exitCode = ddlMayHaveRun ? 4 : 5;
      if (ddlMayHaveRun) reason = 'UNCONFIRMED';
    }
    output = {
      version: FLOW_OPERATION_VERSION,
      mode: command?.mode.toUpperCase() ?? 'UNKNOWN',
      status: 'ERROR',
      ...(command ? { target: command.target } : {}),
      error: {
        stage,
        reason,
        acknowledgedActionIds,
        ...(actionId ? { actionId } : {}),
      },
      ddlMayHaveRun,
      connectionClosed: true,
    };
  } finally {
    if (connection)
      try {
        await connection.close();
      } catch {
        exitCode = 6;
        output = {
          version: FLOW_OPERATION_VERSION,
          status: 'ERROR',
          error: { stage: 'CLOSE', reason: 'UNCONFIRMED' },
          connectionClosed: false,
          knownOperationResult: output,
        };
      }
  }
  return { exitCode, output };
}
