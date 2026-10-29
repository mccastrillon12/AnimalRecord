import { Connection, Model, STATES, mongo } from 'mongoose';
import { AnimalMediaUpload } from '../domain/animal-media-upload';
import { AnimalWriteJournal } from '../../animal-transfer/domain/animal-write-journal';
import { AnimalOwnershipControlEntity } from '../../animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { PromotionRow } from '../domain/media-promotion-persistence';
import { AnimalMediaPromotionConfirmation } from '../domain/media-promotion-confirmation-runner';
import { MediaPromotionConfirmationError } from '../application/media-promotion-confirmation';
import {
  AwsMediaPromotionConfirmation,
  AwsPromotionConfirmationConfig,
} from './aws-media-promotion-confirmation';
import { MongoMediaPromotionPersistence } from './mongo-media-promotion-persistence';
import { MongoMediaPromotionReadiness } from './mongo-media-promotion-readiness';

export type PromotionMongoBinding = {
  connection: Connection;
  records: Model<PromotionRow>;
  journals: Model<AnimalWriteJournal>;
  controls: Model<AnimalOwnershipControlEntity>;
  uploads: Model<AnimalMediaUpload>;
};
export class MediaPromotionAssemblyError extends Error {
  readonly name = 'MediaPromotionAssemblyError';
  constructor(readonly stage: 'CONFIGURATION' | 'BINDING' | 'REQUIREMENTS') {
    super(`Media promotion assembly failed at ${stage}`);
  }
}

/** Explicit preparation only. Supplied models/connection are never opened or initialized here. */
export async function prepareMediaPromotionConfirmation(
  raw: PromotionMongoBinding,
  expectedDatabaseName: string,
  config: AwsPromotionConfirmationConfig,
): Promise<AnimalMediaPromotionConfirmation> {
  // Capture identities before inspecting metadata; caller mutation cannot retarget this run.
  let binding: Readonly<PromotionMongoBinding>;
  try {
    binding = Object.freeze({
      connection: raw.connection,
      records: raw.records,
      journals: raw.journals,
      controls: raw.controls,
      uploads: raw.uploads,
    });
  } catch {
    throw new MediaPromotionAssemblyError('BINDING');
  }
  const connection = binding.connection;
  let db: NonNullable<Connection['db']>;
  const models = [
    binding.records,
    binding.uploads,
    binding.journals,
    binding.controls,
  ] as const;
  const names = [
    'animal_media_promotion_records',
    'animal_media_uploads',
    'animal_write_journals',
    'animal_ownership_controls',
  ];
  let client: ReturnType<Connection['getClient']>;
  let collections: Array<(typeof models)[number]['collection']>;
  const native = (collection: (typeof collections)[number]) =>
    (collection as unknown as { collection?: mongo.Collection }).collection;
  let handles: Array<mongo.Collection | undefined>;
  try {
    const candidate = connection?.db;
    if (
      !connection ||
      connection.readyState !== STATES.connected ||
      !candidate ||
      !expectedDatabaseName ||
      candidate.databaseName !== expectedDatabaseName
    )
      throw new Error();
    db = candidate;
    client = connection.getClient();
    if (!client) throw new Error();
    collections = models.map((model) => model.collection);
    handles = collections.map(native);
  } catch {
    throw new MediaPromotionAssemblyError('BINDING');
  }
  const assertBinding = () => {
    try {
      if (
        connection.readyState !== STATES.connected ||
        connection.db !== db ||
        connection.getClient() !== client ||
        db.databaseName !== expectedDatabaseName ||
        models.some(
          (model, i) =>
            model.db !== connection ||
            model.collection !== collections[i] ||
            model.collection.conn !== connection ||
            model.collection.name !== names[i] ||
            native(model.collection) !== handles[i] ||
            !handles[i] ||
            handles[i].db !== db ||
            handles[i].dbName !== expectedDatabaseName ||
            handles[i].collectionName !== names[i],
        )
      )
        throw new Error();
    } catch {
      throw new MediaPromotionAssemblyError('BINDING');
    }
  };
  assertBinding();
  let runtime: AwsMediaPromotionConfirmation;
  try {
    const persistence = new MongoMediaPromotionPersistence(
      binding.records,
      binding.journals,
      binding.controls,
      binding.uploads,
    );
    runtime = new AwsMediaPromotionConfirmation(persistence, config);
  } catch {
    throw new MediaPromotionAssemblyError('CONFIGURATION');
  }
  try {
    const report = await new MongoMediaPromotionReadiness(
      db,
      expectedDatabaseName,
    ).inspect();
    if (report.status !== 'SATISFIED' || report.issues.length !== 0)
      throw new Error();
  } catch {
    throw new MediaPromotionAssemblyError('REQUIREMENTS');
  }
  assertBinding();
  return Object.freeze({
    confirm: (input) => {
      try {
        assertBinding();
      } catch {
        return Promise.reject(
          new MediaPromotionConfirmationError('INPUT', 'UNAVAILABLE'),
        );
      }
      // Metadata is a startup prerequisite, never a journal fence or a send permission.
      return runtime.confirm(input);
    },
  } satisfies AnimalMediaPromotionConfirmation);
}
