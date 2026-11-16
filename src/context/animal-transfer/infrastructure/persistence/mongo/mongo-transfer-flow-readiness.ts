import { mongo } from 'mongoose';
import {
  assessTransferFlowMongo,
  FLOW_REQUIREMENTS,
  FlowMetadata,
  FlowTarget,
  copyFlowTarget,
} from '../../../domain/transfer-flow-mongo-requirements';
import { validFlowTarget } from '../../../application/transfer-flow-index-maintenance';
export type FlowInspectionDb = Pick<
  mongo.Db,
  'databaseName' | 'admin' | 'listCollections' | 'collection' | 'client'
>;
export class FlowReadinessError extends Error {
  readonly name = 'FlowReadinessError';
  constructor(readonly stage: 'TARGET' | 'METADATA') {
    super(`Transfer flow Mongo inspection failed at ${stage}`);
  }
}
/** Reads metadata only on a supplied Db. No connection, environment or app import. */
export class MongoTransferFlowReadiness {
  private readonly target: FlowTarget;
  constructor(
    private readonly db: FlowInspectionDb,
    target: FlowTarget,
  ) {
    this.target = copyFlowTarget(target);
  }
  async inspect() {
    const target = this.target,
      db = this.db;
    if (
      !validFlowTarget(target) ||
      !db ||
      db.databaseName !== target.databaseName
    )
      throw new FlowReadinessError('TARGET');
    try {
      const options = {
        readPreference: 'primary' as const,
        maxTimeMS: 5000,
        timeoutMS: 5000,
      };
      const hello = (await db
        .admin()
        .command({ hello: 1 }, options)) as FlowMetadata['hello'];
      const listed = await db
        .listCollections(
          { name: { $in: FLOW_REQUIREMENTS.map((c) => c.name) } },
          { ...options, nameOnly: false, authorizedCollections: false },
        )
        .toArray();
      const collections: FlowMetadata['collections'] = [];
      for (const c of FLOW_REQUIREMENTS)
        for (const found of listed.filter((r) => r.name === c.name)) {
          const raw: unknown =
            found.type === 'collection'
              ? await db.collection(c.name).listIndexes(options).toArray()
              : [];
          if (
            !Array.isArray(raw) ||
            raw.some(
              (v: unknown) => !v || typeof v !== 'object' || Array.isArray(v),
            )
          )
            throw new Error('Invalid index metadata');
          collections.push({
            name: c.name,
            type: found.type,
            options: found.options,
            indexes: raw as Array<Record<string, unknown>>,
          });
        }
      return assessTransferFlowMongo(
        { hello, collections, clientTimeoutMS: db.client.options.timeoutMS },
        target,
        new Date().toISOString(),
      );
    } catch {
      throw new FlowReadinessError('METADATA');
    }
  }
}
