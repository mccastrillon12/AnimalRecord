import type { Logger } from '@nestjs/common';
import { mongo } from 'mongoose';
import {
  FLOW_REQUIREMENTS,
  flowIndexName,
  matchesFlowIndex,
  sameFlowKey,
} from '../../../domain/transfer-flow-mongo-requirements';

export function listFlowCollections(db: mongo.Db) {
  // Some Atlas proxies reject compound collection-name filters.
  return db
    .listCollections(
      {},
      { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
    )
    .toArray();
}

export function isOrdinaryFlowCollection(
  collection?: mongo.CollectionInfo,
): boolean {
  return (
    collection?.type === 'collection' &&
    collection.options?.capped !== true &&
    !collection.options?.timeseries
  );
}

export async function prepareTransferFlowStorage(
  db: mongo.Db | undefined,
  names: readonly string[],
  logger: Pick<Logger, 'log' | 'warn'>,
  eventScope: string,
): Promise<void> {
  let phase: 'COLLECTIONS' | 'CREATE_COLLECTION' | 'INDEXES' = 'COLLECTIONS';
  let collection: string | undefined;
  try {
    if (!db) throw new Error('Application database is unavailable');
    let collections = await listFlowCollections(db);
    const missing = names.filter(
      (name) => !collections.some((entry) => entry.name === name),
    );
    for (const name of missing) {
      phase = 'CREATE_COLLECTION';
      collection = name;
      try {
        await db.createCollection(name, { timeoutMS: 15000 });
      } catch (error) {
        // A concurrent initializer can create the namespace first.
        if (!(error instanceof mongo.MongoServerError) || error.code !== 48)
          throw error;
      }
    }
    phase = 'COLLECTIONS';
    collection = undefined;
    if (missing.length > 0) collections = await listFlowCollections(db);
    for (const name of names) {
      collection = name;
      if (
        !isOrdinaryFlowCollection(
          collections.find((entry) => entry.name === name),
        )
      )
        throw new Error('Application collection is incompatible');
    }
    phase = 'INDEXES';
    for (const name of names) {
      collection = name;
      const definition = FLOW_REQUIREMENTS.find((entry) => entry.name === name);
      if (!definition)
        throw new Error('Application index definitions are missing');
      const required = definition.indexes.filter(
        (index) => !sameFlowKey(index.key, { _id: 1 }),
      );
      if (!required.length) continue;
      const target = db.collection(name);
      const existing = await target
        .listIndexes({ readPreference: 'primary', timeoutMS: 5000 })
        .toArray();
      for (const index of required) {
        if (existing.some((entry) => matchesFlowIndex(entry, index))) continue;
        await target.createIndex(
          { ...index.key },
          {
            name: flowIndexName(index.id),
            ...(index.unique ? { unique: true } : {}),
            ...(index.sparse ? { sparse: true } : {}),
            collation: { locale: 'simple' },
            timeoutMS: 15000,
          },
        );
      }
    }
    logger.log({ event: `${eventScope}-storage-prepared` });
  } catch (error) {
    // Preparation for one feature must not prevent other modules from starting.
    logger.warn({
      event: `${eventScope}-storage-preparation-failed`,
      phase,
      collection,
      mongoCode:
        error instanceof mongo.MongoServerError &&
        typeof error.code === 'number'
          ? error.code
          : undefined,
    });
  }
}
