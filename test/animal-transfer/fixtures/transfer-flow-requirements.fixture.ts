import {
  assessTransferFlowMongo,
  FLOW_REQUIREMENTS,
  FlowMetadata,
  FlowTarget,
  flowIndexName,
} from '../../../src/context/animal-transfer/domain/transfer-flow-mongo-requirements';
import {
  FlowIndexAction,
  FlowMaintenancePort,
  flowActionDefinition,
  TransferFlowIndexMaintenance,
} from '../../../src/context/animal-transfer/application/transfer-flow-index-maintenance';
export const flowTarget: FlowTarget = {
  databaseName: 'animalrecord_operational_test',
  replicaSet: 'synthetic_rs',
};
export const flowAt = '2026-10-29T12:00:00.000Z';
export function completeFlowMetadata(): FlowMetadata {
  return {
    hello: {
      setName: flowTarget.replicaSet,
      isWritablePrimary: true,
      logicalSessionTimeoutMinutes: 30,
    },
    collections: FLOW_REQUIREMENTS.map((c) => ({
      name: c.name,
      type: 'collection',
      options: {},
      indexes: c.indexes.map((i) => ({
        name:
          Object.keys(i.key).join(',') === '_id' ? '_id_' : flowIndexName(i.id),
        key: { ...i.key },
        ...(i.unique && Object.keys(i.key).join(',') !== '_id'
          ? { unique: true }
          : {}),
        ...(i.sparse ? { sparse: true } : {}),
      })),
    })),
  };
}
export function flowMaintenanceFixture() {
  const metadata = completeFlowMetadata(),
    created: FlowIndexAction[] = [];
  const faults = { lostAck: false, create: false, inspect: false };
  const port: FlowMaintenancePort = {
    inspect: jest.fn(() =>
      faults.inspect
        ? Promise.reject(new Error('private URI unavailable'))
        : Promise.resolve(
            assessTransferFlowMongo(metadata, flowTarget, flowAt),
          ),
    ),
    create: jest.fn((action) => {
      if (faults.create)
        return Promise.reject(new Error('private duplicate value'));
      const d = flowActionDefinition(action);
      created.push(structuredClone(action));
      if (!d.index)
        metadata.collections.push({
          name: d.collection,
          type: 'collection',
          options: {},
          indexes: [{ name: '_id_', key: { _id: 1 } }],
        });
      else
        metadata.collections
          .find((c) => c.name === d.collection)!
          .indexes.push({
            name: d.name,
            key: { ...d.index.key },
            ...(d.index.unique ? { unique: true } : {}),
            ...(d.index.sparse ? { sparse: true } : {}),
          });
      return faults.lostAck
        ? Promise.reject(new Error('synthetic ack lost after DDL'))
        : Promise.resolve();
    }),
  };
  return {
    metadata,
    created,
    faults,
    port,
    operator: new TransferFlowIndexMaintenance(port, flowTarget),
    report: () => assessTransferFlowMongo(metadata, flowTarget, flowAt),
  };
}
