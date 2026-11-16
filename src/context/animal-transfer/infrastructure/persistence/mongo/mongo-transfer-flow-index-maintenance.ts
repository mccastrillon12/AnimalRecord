import {
  FlowIndexAction,
  FlowMaintenancePort,
  TransferFlowIndexMaintenance,
  flowActionDefinition,
  validFlowTarget,
} from '../../../application/transfer-flow-index-maintenance';
import {
  FlowTarget,
  copyFlowTarget,
} from '../../../domain/transfer-flow-mongo-requirements';
import {
  FlowInspectionDb,
  MongoTransferFlowReadiness,
} from './mongo-transfer-flow-readiness';
import { mongo } from 'mongoose';

/** Explicit additive DDL port, outside the application graph and HTTP. */
export class MongoTransferFlowIndexMaintenance implements FlowMaintenancePort {
  private readonly target: FlowTarget;
  private readonly inspector: MongoTransferFlowReadiness;
  constructor(
    private readonly db: FlowInspectionDb & Pick<mongo.Db, 'createCollection'>,
    target: FlowTarget,
  ) {
    this.target = copyFlowTarget(target);
    this.inspector = new MongoTransferFlowReadiness(db, this.target);
  }
  operator() {
    return new TransferFlowIndexMaintenance(this, this.target);
  }
  inspect() {
    return this.inspector.inspect();
  }
  async create(raw: FlowIndexAction): Promise<void> {
    if (
      !validFlowTarget(this.target) ||
      this.db.databaseName !== this.target.databaseName
    )
      throw new Error('Invalid flow maintenance target');
    const definition = flowActionDefinition(raw);
    if (!definition.index) {
      await this.db.createCollection(definition.collection, {
        collation: { locale: 'simple' },
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxTimeMS: 60000,
        timeoutMS: 65000,
      });
      return;
    }
    await this.db
      .collection(definition.collection, {
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
      })
      .createIndex(
        { ...definition.index.key },
        {
          name: definition.name,
          ...(definition.index.unique ? { unique: true } : {}),
          ...(definition.index.sparse ? { sparse: true } : {}),
          collation: { locale: 'simple' },
          commitQuorum: 'majority',
          maxTimeMS: 60000,
          timeoutMS: 65000,
        },
      );
  }
}
