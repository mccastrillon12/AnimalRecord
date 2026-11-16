import { mongo } from 'mongoose';
import {
  assessPromotionMongoRequirements,
  PROMOTION_MONGO_REQUIREMENTS,
  PromotionMongoMetadata,
  PromotionMongoRequirementsReport,
} from '../domain/media-promotion-mongo-requirements';

export class MediaPromotionReadinessError extends Error {
  readonly name = 'MediaPromotionReadinessError';
  constructor(readonly stage: 'TARGET' | 'METADATA') {
    super(`Promotion Mongo inspection failed at ${stage}`);
  }
}
/** Explicit inspection of an already selected Db. No connection/bootstrap or writes. */
export class MongoMediaPromotionReadiness {
  constructor(
    private readonly db: Pick<
      mongo.Db,
      'databaseName' | 'admin' | 'listCollections' | 'collection'
    >,
    private readonly expectedDatabaseName: string,
  ) {}

  async inspect(): Promise<PromotionMongoRequirementsReport> {
    const db = this.db,
      expected = this.expectedDatabaseName;
    if (
      typeof expected !== 'string' ||
      !expected ||
      !db ||
      db.databaseName !== expected
    )
      throw new MediaPromotionReadinessError('TARGET');
    try {
      const options = { readPreference: 'primary' as const, maxTimeMS: 5000 };
      const hello = (await db
        .admin()
        .command({ hello: 1 }, options)) as PromotionMongoMetadata['hello'];
      const listed = await db
        .listCollections(
          { name: { $in: PROMOTION_MONGO_REQUIREMENTS.map((r) => r.name) } },
          { ...options, nameOnly: false, authorizedCollections: false },
        )
        .toArray();
      const collections: PromotionMongoMetadata['collections'] = [];
      for (const requirement of PROMOTION_MONGO_REQUIREMENTS) {
        const found = listed.filter((c) => c.name === requirement.name);
        for (const collection of found) {
          // Views are reported as incompatible; never query a view's backing data.
          const rawIndexes: unknown =
            collection.type === 'collection'
              ? await db
                  .collection(requirement.name)
                  .listIndexes(options)
                  .toArray()
              : [];
          if (!Array.isArray(rawIndexes))
            throw new Error('Invalid index metadata');
          const indexes = rawIndexes.map((raw: unknown) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
              throw new Error('Invalid index metadata');
            return raw as Record<string, unknown>;
          });
          collections.push({
            name: requirement.name,
            type: collection.type,
            options: collection.options,
            indexes,
          });
        }
      }
      return assessPromotionMongoRequirements(
        { hello, collections },
        new Date().toISOString(),
      );
    } catch {
      throw new MediaPromotionReadinessError('METADATA');
    }
  }
}
