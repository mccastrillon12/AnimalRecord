import { mongo } from 'mongoose';
import {
  MediaPromotionIndexMaintenance,
  PromotionIndexAction,
  PromotionIndexMaintenancePort,
} from '../application/media-promotion-index-maintenance';
import { PROMOTION_MONGO_REQUIREMENTS } from '../domain/media-promotion-mongo-requirements';
import { MongoMediaPromotionReadiness } from './mongo-media-promotion-readiness';

/** Explicit DDL port. Not registered, invoked at startup, or exposed over HTTP. */
export class MongoMediaPromotionIndexMaintenance implements PromotionIndexMaintenancePort {
  private readonly inspector: MongoMediaPromotionReadiness;
  constructor(
    private readonly db: Pick<
      mongo.Db,
      | 'databaseName'
      | 'admin'
      | 'listCollections'
      | 'collection'
      | 'createCollection'
    >,
    private readonly expectedDatabaseName: string,
  ) {
    this.inspector = new MongoMediaPromotionReadiness(db, expectedDatabaseName);
  }
  operator(): MediaPromotionIndexMaintenance {
    return new MediaPromotionIndexMaintenance(this, this.expectedDatabaseName);
  }
  inspect() {
    return this.inspector.inspect();
  }
  async create(raw: PromotionIndexAction): Promise<void> {
    // Decode exclusively from the manifest. No caller-supplied key/options reach Mongo.
    const collection = PROMOTION_MONGO_REQUIREMENTS.find(
      (c) => c.name === raw?.collection,
    );
    if (!collection || this.db.databaseName !== this.expectedDatabaseName)
      throw new Error('Invalid maintenance target');
    if (
      raw.type === 'CREATE_COLLECTION' &&
      raw.id === `COLLECTION:${collection.name}` &&
      raw.key === undefined &&
      raw.options === undefined
    ) {
      await this.db.createCollection(collection.name, {
        collation: { locale: 'simple' },
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxTimeMS: 60000,
      });
      return;
    }
    const index = collection.indexes.find((i) => i.id === raw.id);
    if (!index || raw.type !== 'CREATE_INDEX')
      throw new Error('Invalid index requirement');
    await this.db
      .collection(collection.name, {
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
      })
      .createIndex(
        { ...index.key },
        {
          name: `ar_promotion_v1_${index.id.toLowerCase()}`,
          ...(index.unique ? { unique: true } : {}),
          ...(index.partialFilterExpression
            ? { partialFilterExpression: { ...index.partialFilterExpression } }
            : {}),
          collation: { locale: 'simple' },
          commitQuorum: 'majority',
          maxTimeMS: 60000,
        },
      );
  }
}
