import {
  flowMaintenanceFixture,
  flowTarget,
} from '../fixtures/transfer-flow-requirements.fixture';
import {
  flowActionDefinition,
  flowPlan,
  TransferFlowIndexMaintenance,
} from '../../../src/context/animal-transfer/application/transfer-flow-index-maintenance';

describe('Explicit additive operational workflow with simulated metadata/DDL', () => {
  it('plans all missing owned collections and declared non-native indexes, then verifies them; never creates shared storage', async () => {
    const f = flowMaintenanceFixture();
    f.metadata.collections = f.metadata.collections.filter((c) =>
      [
        'users',
        'animals',
        'animal_ownership_controls',
        'animal_transfer_reasons',
      ].includes(c.name),
    );
    const plan = await f.operator.prepare();
    expect(plan.status).toBe('READY');
    expect(plan.actions).toHaveLength(21);
    expect(f.created).toHaveLength(0);
    const result = await f.operator.apply({
      ...flowTarget,
      reviewedPlanId: plan.planId,
    });
    expect(result.report.status).toBe('SATISFIED');
    expect(result.acknowledgedActionIds).toHaveLength(21);
    expect(f.created.some((a) => a.collection === 'users')).toBe(false);
    expect(result.report.activation).toBe('DISABLED');
    expect(
      (await new TransferFlowIndexMaintenance(f.port, flowTarget).prepare())
        .status,
    ).toBe('NO_CHANGES');
  });
  it.each([
    'users',
    'animals',
    'animal_ownership_controls',
    'animal_transfer_reasons',
  ])(
    'blocks missing shared collection %s without any proposed DDL',
    async (name) => {
      const f = flowMaintenanceFixture();
      f.metadata.collections = f.metadata.collections.filter(
        (c) => c.name !== name,
      );
      const plan = await f.operator.prepare();
      expect(plan.status).toBe('BLOCKED');
      expect(plan.actions).toEqual([]);
      await expect(
        f.operator.apply({ ...flowTarget, reviewedPlanId: plan.planId }),
      ).rejects.toMatchObject({ stage: 'REVIEW', reason: 'BLOCKED' });
      expect(f.created).toEqual([]);
    },
  );
  it('blocks missing shared indexes and incompatible owned options instead of repairing them', async () => {
    const f = flowMaintenanceFixture();
    f.metadata.collections[0].indexes.pop();
    expect((await f.operator.prepare()).status).toBe('BLOCKED');
    expect(() =>
      flowActionDefinition({
        type: 'CREATE_INDEX',
        id: 'USER_PHONE',
        collection: 'users',
      }),
    ).toThrow();
  });
  it('binds a stable plan to target/manifest/issues/actions, independent of observation time/order', async () => {
    const f = flowMaintenanceFixture();
    f.metadata.collections.pop();
    const a = await f.operator.prepare(),
      b = flowPlan(flowTarget, {
        ...f.report(),
        observedAt: '2026-10-30T12:00:00.000Z',
        issues: [...f.report().issues].reverse(),
      });
    expect(a.planId).toBe(b.planId);
    expect(
      flowPlan(
        {
          replicaSet: flowTarget.replicaSet,
          databaseName: flowTarget.databaseName,
        },
        f.report(),
      ).planId,
    ).toBe(a.planId);
    expect(Object.isFrozen(a.actions)).toBe(true);
    expect(Object.isFrozen(a.report.issues)).toBe(true);
    await expect(
      f.operator.apply({
        ...flowTarget,
        databaseName: 'other',
        reviewedPlanId: a.planId,
      }),
    ).rejects.toMatchObject({ stage: 'INPUT' });
  });
  it('rejects a changed reviewed plan before writes and does not reuse its instance', async () => {
    const f = flowMaintenanceFixture();
    const plan = await f.operator.prepare();
    f.metadata.collections.pop();
    await expect(
      f.operator.apply({ ...flowTarget, reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({ reason: 'CHANGED' });
    await expect(
      f.operator.apply({ ...flowTarget, reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({ stage: 'LIFECYCLE' });
    expect(f.created).toEqual([]);
  });
  it('preserves uncertain DDL after lost acknowledgement, with no automatic adoption/retry/rollback', async () => {
    const f = flowMaintenanceFixture();
    f.metadata.collections.pop();
    const plan = await f.operator.prepare();
    f.faults.lostAck = true;
    await expect(
      f.operator.apply({ ...flowTarget, reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'APPLY',
      reason: 'UNCERTAIN',
      acknowledgedActionIds: [],
      actionId: plan.actions[0].id,
    });
    expect(f.created).toHaveLength(1);
    expect(
      (await new TransferFlowIndexMaintenance(f.port, flowTarget).prepare())
        .actions,
    ).toHaveLength(1);
  });
  it('stops on metadata drift between actions and reports only acknowledged progress', async () => {
    const f = flowMaintenanceFixture();
    f.metadata.collections.pop();
    const plan = await f.operator.prepare();
    const create = f.port.create.bind(f.port);
    f.port.create = async (a) => {
      await create(a);
      f.metadata.hello.isWritablePrimary = false;
    };
    await expect(
      f.operator.apply({ ...flowTarget, reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'REVIEW',
      reason: 'CHANGED',
      acknowledgedActionIds: [plan.actions[0].id],
    });
    expect(f.created).toHaveLength(1);
  });
  it('sanitizes inspect/create errors and never accepts extra caller DDL fields', async () => {
    const f = flowMaintenanceFixture();
    f.faults.inspect = true;
    await expect(f.operator.prepare()).rejects.toMatchObject({
      message: expect.not.stringContaining('private') as unknown,
    });
    expect(() =>
      flowActionDefinition({
        type: 'CREATE_INDEX',
        id: 'ATTEMPT_ORDINAL',
        collection: 'notification_push_attempts',
        key: { injected: 1 },
      } as never),
    ).toThrow();
  });
  it('refuses a report with extra private fields and captures target mutations before I/O', async () => {
    const f = flowMaintenanceFixture();
    expect(() =>
      flowPlan(flowTarget, {
        ...f.report(),
        privatePayload: 'secret',
      } as never),
    ).toThrow('Invalid');
    const target = { ...flowTarget },
      operator = new TransferFlowIndexMaintenance(f.port, target);
    target.databaseName = 'other';
    expect((await operator.prepare()).target).toEqual(flowTarget);
  });
});
