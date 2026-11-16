import {
  FlowOperationPorts,
  FlowReview,
  runFlowOperation,
} from '../../../src/operations/transfer-flow-operation';
import {
  flowMaintenanceFixture,
  flowTarget,
} from '../fixtures/transfer-flow-requirements.fixture';

const prepare = [
  'prepare',
  '--database-name',
  flowTarget.databaseName,
  '--replica-set',
  flowTarget.replicaSet,
];
const env = {
  TRANSFER_FLOW_OPERATION_MONGO_URI:
    'mongodb://user:private-password@127.0.0.1:27018/?replicaSet=synthetic_rs',
};
function fixture() {
  const f = flowMaintenanceFixture();
  const connection = {
    deployment: {
      protocol: 'mongodb' as const,
      hosts: ['127.0.0.1:27018'],
      tls: false,
      directConnection: true,
    },
    open: jest.fn().mockResolvedValue(f.operator),
    close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const ports = {
    connection: jest.fn(() => connection),
    readReview: jest.fn<Promise<string>, [string]>(),
  } satisfies FlowOperationPorts;
  const run = (args = prepare, input = env) =>
    runFlowOperation(args, input, ports);
  const apply = (r: FlowReview) => [
    'apply',
    ...prepare.slice(1),
    '--review-file',
    'reviewed.json',
    '--review-id',
    r.reviewId,
    '--execute',
  ];
  async function reviewed() {
    const result = await run();
    const review = result.output as FlowReview;
    ports.readReview.mockResolvedValue(JSON.stringify(review));
    return review;
  }
  return { ...f, connection, ports, run, apply, reviewed };
}
describe('Standalone operational workflow, only injected connections and simulated DDL', () => {
  it('prints help without env, file reads, client construction or connection', async () => {
    const f = fixture();
    expect(await f.run(['--help'], {} as typeof env)).toMatchObject({
      exitCode: 0,
      output: { mode: 'HELP' },
    });
    expect(f.ports.connection).not.toHaveBeenCalled();
    expect(f.ports.readReview).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      ['unknown'],
      ['prepare'],
      [...prepare, '--execute'],
      [...prepare, '--uri', 'private-password'],
      [...prepare, '--database-name', 'other'],
      ['apply', ...prepare.slice(1)],
    ].map((args) => ({ args })),
  )('fails arguments before any I/O: %j', async ({ args }) => {
    const f = fixture(),
      result = await f.run(args);
    expect(result.exitCode).toBe(2);
    expect(f.ports.connection).not.toHaveBeenCalled();
    expect(f.ports.readReview).not.toHaveBeenCalled();
    expect(JSON.stringify(result.output)).not.toContain('private-password');
  });
  it('does not fall back to the server or harness URI variables', async () => {
    const f = fixture();
    const result = await f.run(prepare, {
      MONGO_URI: env.TRANSFER_FLOW_OPERATION_MONGO_URI,
      TRANSFER_FLOW_MONGO_TEST_URI: env.TRANSFER_FLOW_OPERATION_MONGO_URI,
    } as never);
    expect(result.exitCode).toBe(2);
    expect(f.ports.connection).not.toHaveBeenCalled();
  });
  it('prepares a credential-free review document, closes the client and makes no writes', async () => {
    const f = fixture(),
      result = await f.run();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      version: 'TRANSFER_FLOW_REVIEW_V1',
      plan: { status: 'NO_CHANGES', target: flowTarget },
      reviewId: expect.any(String) as unknown,
    });
    expect(f.created).toEqual([]);
    expect(f.connection.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.output)).not.toMatch(
      /private-password|mongodb:\/\/|user:/,
    );
  });
  it('returns a blocked review with exit 3, without creating a shared source', async () => {
    const f = fixture();
    f.metadata.collections.shift();
    const result = await f.run();
    expect(result.exitCode).toBe(3);
    expect(result.output).toMatchObject({
      plan: { status: 'BLOCKED', actions: [] },
    });
    expect(f.created).toEqual([]);
  });
  it('applies a reviewed plan with explicit execution and returns only acknowledged effects', async () => {
    const f = fixture();
    f.metadata.collections.pop();
    const review = await f.reviewed();
    const result = await f.run(f.apply(review));
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      status: 'ACKNOWLEDGED',
      report: {
        status: 'SATISFIED',
        activation: 'DISABLED',
        data: 'NOT_ASSESSED',
        transactions: 'NOT_PROBED',
      },
      connectionClosed: true,
    });
    expect(f.created).toHaveLength(2);
    expect(f.connection.close).toHaveBeenCalledTimes(2);
  });
  it.each(['execute', 'review-id', 'review-file'])(
    'requires explicit %s before opening a connection',
    async (missing) => {
      const f = fixture(),
        review = await f.reviewed();
      f.ports.connection.mockClear();
      const args = f.apply(review),
        at = args.indexOf(`--${missing}`);
      args.splice(at, missing === 'execute' ? 1 : 2);
      expect((await f.run(args)).exitCode).toBe(2);
      expect(f.ports.connection).not.toHaveBeenCalled();
    },
  );
  it.each(['target', 'actions', 'timestamp', 'private-field', 'json'] as const)(
    'refuses tampered %s in the review file before client construction',
    async (kind) => {
      const f = fixture(),
        review = await f.reviewed();
      const raw = structuredClone(review);
      if (kind === 'target')
        Object.assign(raw.plan.target, { databaseName: 'other' });
      if (kind === 'actions')
        Object.assign(raw.plan, {
          actions: [
            {
              collection: 'users',
              type: 'CREATE_COLLECTION',
              id: 'COLLECTION:users',
            },
          ],
        });
      if (kind === 'timestamp')
        Object.assign(raw.plan.report, {
          observedAt: '2026-10-30T12:00:00.000Z',
        });
      if (kind === 'private-field')
        Object.assign(raw, { privatePayload: 'do not expose' });
      f.ports.readReview.mockResolvedValue(
        kind === 'json' ? '{invalid' : JSON.stringify(raw),
      );
      f.ports.connection.mockClear();
      expect((await f.run(f.apply(review))).exitCode).toBe(2);
      expect(f.ports.connection).not.toHaveBeenCalled();
    },
  );
  it('rejects endpoint drift before opening its client, and still closes the unconnected client', async () => {
    const f = fixture(),
      review = await f.reviewed();
    f.connection.deployment.hosts = ['other.invalid:27018'];
    const result = await f.run(f.apply(review));
    expect(result.exitCode).toBe(2);
    expect(f.connection.open).toHaveBeenCalledTimes(1);
    expect(f.connection.close).toHaveBeenCalledTimes(2);
    expect(f.created).toEqual([]);
  });
  it('closes a partially opened client and sanitizes a failed connection', async () => {
    const f = fixture();
    f.connection.open.mockRejectedValue(
      new Error(env.TRANSFER_FLOW_OPERATION_MONGO_URI),
    );
    const result = await f.run();
    expect(result.exitCode).toBe(5);
    expect(result.output).toMatchObject({
      error: { stage: 'CONNECT' },
      ddlMayHaveRun: false,
      connectionClosed: true,
    });
    expect(f.connection.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.output)).not.toMatch(
      /private-password|127.0.0.1/,
    );
  });
  it('retains uncertain application progress after lost DDL acknowledgement, without retry or inference of rollback', async () => {
    const f = fixture();
    f.metadata.collections.pop();
    const review = await f.reviewed();
    f.faults.lostAck = true;
    const result = await f.run(f.apply(review));
    expect(result.exitCode).toBe(4);
    expect(result.output).toMatchObject({
      error: { stage: 'APPLY', reason: 'UNCERTAIN', acknowledgedActionIds: [] },
      ddlMayHaveRun: true,
    });
    expect(f.created).toHaveLength(1);
    expect(f.connection.close).toHaveBeenCalledTimes(2);
  });
  it('does not report a close failure as a successful preparation', async () => {
    const f = fixture();
    f.connection.close.mockRejectedValue(new Error('private close error'));
    const result = await f.run();
    expect(result.exitCode).toBe(6);
    expect(result.output).toMatchObject({
      status: 'ERROR',
      connectionClosed: false,
      error: { stage: 'CLOSE' },
    });
    expect(JSON.stringify(result.output)).not.toContain('private close');
  });
  it('preserves primary uncertainty and acknowledged progress if close also fails', async () => {
    const f = fixture();
    f.metadata.collections.pop();
    const review = await f.reviewed();
    f.faults.lostAck = true;
    f.connection.close.mockRejectedValue(new Error('raw credentials'));
    const result = await f.run(f.apply(review));
    expect(result.exitCode).toBe(6);
    expect(result.output).toMatchObject({
      connectionClosed: false,
      knownOperationResult: {
        error: { reason: 'UNCERTAIN' },
        ddlMayHaveRun: true,
      },
    });
  });
  it('captures URI/arguments before waiting for the local review file', async () => {
    const f = fixture(),
      review = await f.reviewed(),
      args = f.apply(review),
      input = { ...env };
    let release!: (value: string) => void;
    f.ports.readReview.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const result = f.run(args, input);
    args[2] = 'other';
    input.TRANSFER_FLOW_OPERATION_MONGO_URI = 'mongodb://other.invalid:27017/';
    release(JSON.stringify(review));
    expect((await result).exitCode).toBe(0);
    expect(f.ports.connection.mock.calls.at(-1)).toEqual([
      env.TRANSFER_FLOW_OPERATION_MONGO_URI,
      flowTarget,
    ]);
  });
});
