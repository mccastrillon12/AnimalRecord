import { validate as isUuid } from 'uuid';
import { LegacyAnimalMediaMigration } from '../context/animal-media/application/legacy-animal-media-migration';
import { validMediaMigrationRetention } from '../context/animal-media/domain/animal-media-upload';
import type {
  MediaMigration,
  MediaMigrationDefinition,
  MediaMigrationStop,
} from '../context/animal-media/domain/legacy-media-migration';
import { ConflictError } from '../context/shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../context/shared/domain/errors/ResourceNotFoundError';

const usage = [
  'status DATABASE BUCKET JOB',
  'start DATABASE BUCKET JOB ANIMAL OWNER OWNERSHIP_VERSION media|medical BUCKET_OWNER RETAIN_UNTIL_UTC --execute',
  'advance DATABASE BUCKET JOB --execute',
  'stop DATABASE BUCKET JOB REVISION REQUEST OPERATOR SOURCE_REVISION_UNAVAILABLE|OPERATOR_INTERVENTION EVIDENCE_REF --execute',
];

export type RetainedMigrationTarget = Readonly<{
  database: string;
  bucket: string;
}>;
type Action = RetainedMigrationTarget & { id: string } & (
    | { mode: 'status' | 'advance' }
    | { mode: 'start'; definition: MediaMigrationDefinition }
    | { mode: 'stop'; recovery: MediaMigrationStop }
  );

export type RetainedMigrationConnection = {
  migration: Pick<
    LegacyAnimalMediaMigration,
    'observe' | 'start' | 'migrateBatch' | 'stopForRecovery'
  >;
  verifyIndexes(): Promise<void>;
  verifyBucket(owner: string): Promise<void>;
  close(): Promise<void>;
};

function parse(args: readonly string[]): Action {
  const [mode, database, bucket, id, ...parameters] = args;
  const invalid = () => new Error('Invalid retained migration arguments');
  if (
    !['status', 'start', 'advance', 'stop'].includes(mode) ||
    !database ||
    Buffer.byteLength(database) > 63 ||
    /[\0/\\.\s"$]/.test(database) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !id ||
    !isUuid(id)
  )
    throw invalid();
  const target = { database, bucket, id };
  if (mode === 'status' && parameters.length === 0) return { ...target, mode };
  if (parameters.at(-1) !== '--execute') throw invalid();
  const values = parameters.slice(0, -1);
  if (mode === 'advance' && values.length === 0) return { ...target, mode };
  if (mode === 'start' && values.length === 6) {
    const [
      animalId,
      ownerId,
      version,
      scope,
      expectedBucketOwner,
      retainUntil,
    ] = values;
    const retention = { bucket, expectedBucketOwner, retainUntil };
    const ownershipVersion = Number(version);
    if (
      !isUuid(animalId) ||
      !isUuid(ownerId) ||
      !/^[1-9]\d*$/.test(version) ||
      !Number.isSafeInteger(ownershipVersion) ||
      !['media', 'medical'].includes(scope) ||
      !validMediaMigrationRetention(retention)
    )
      throw invalid();
    return {
      ...target,
      mode,
      definition: {
        id,
        animalId,
        ownerId,
        ownershipVersion,
        retention,
        ...(scope === 'medical' && { scope: 'MEDICAL_DOCUMENTS' }),
      },
    };
  }
  if (mode === 'stop' && values.length === 5) {
    const [revision, requestId, operatorId, reason, evidenceRef] = values;
    const expectedRevision = Number(revision);
    if (
      !/^\d+$/.test(revision) ||
      !Number.isSafeInteger(expectedRevision) ||
      !isUuid(requestId) ||
      !isUuid(operatorId) ||
      (reason !== 'SOURCE_REVISION_UNAVAILABLE' &&
        reason !== 'OPERATOR_INTERVENTION') ||
      !evidenceRef ||
      evidenceRef.length > 200 ||
      /[\r\n]/.test(evidenceRef) ||
      evidenceRef.trim() !== evidenceRef
    )
      throw invalid();
    return {
      ...target,
      mode,
      recovery: {
        id,
        expectedRevision,
        requestId,
        operatorId,
        reason,
        evidenceRef,
      },
    };
  }
  throw invalid();
}

export async function runRetainedMediaMigration(
  args: readonly string[],
  open: (
    target: RetainedMigrationTarget,
  ) => Promise<RetainedMigrationConnection>,
) {
  if (!args.length || (args.length === 1 && args[0] === '--help'))
    return { exitCode: 0, output: { usage } };
  let action: Action;
  try {
    action = parse(args);
  } catch {
    return { exitCode: 2, output: { error: 'ARGUMENTS', usage } };
  }
  let connection: RetainedMigrationConnection | undefined;
  let reported: MediaMigration;
  let stage = 'CONNECT';
  try {
    const { id, mode, database, bucket } = action;
    connection = await open({ database, bucket });
    const { migration } = connection;
    if (mode === 'start') {
      stage = 'MONGO_INDEXES';
      await connection.verifyIndexes();
      stage = 'S3_CONFIGURATION';
      await connection.verifyBucket(
        action.definition.retention!.expectedBucketOwner,
      );
      stage = 'START';
      reported = await migration.start(action.definition);
    } else {
      stage = 'STATUS';
      const job = await migration.observe(id);
      if (job.retention?.bucket !== bucket)
        throw new ConflictError(
          'The job does not belong to this operation and bucket',
        );
      reported = job;
      if (mode === 'stop') {
        stage = 'STOP';
        reported = await migration.stopForRecovery(action.recovery);
      } else if (
        mode === 'advance' &&
        !['COMPLETED', 'STOPPED'].includes(job.phase)
      ) {
        stage = 'MONGO_INDEXES';
        await connection.verifyIndexes();
        stage = 'ADVANCE';
        if (!validMediaMigrationRetention(job.retention))
          throw new ConflictError(
            'Retention expired; consult the job before recovery',
          );
        reported = await migration.migrateBatch(id);
      }
    }
  } catch (error) {
    const message =
      error instanceof ConflictError || error instanceof ResourceNotFoundError
        ? error.message
        : 'Operation could not be confirmed; consult the same job before retrying';
    return { exitCode: 1, output: { error: stage, message } };
  } finally {
    await connection?.close();
  }
  return {
    exitCode: 0,
    output: {
      job: reported.id,
      scope: reported.scope === 'MEDICAL_DOCUMENTS' ? 'medical' : 'media',
      phase: reported.phase,
      revision: reported.revision,
    },
  };
}

if (require.main === module) {
  void runRetainedMediaMigration(process.argv.slice(2), async (target) => {
    const { openRetainedMediaMigration } =
      await import('./retained-media-migration-connection');
    return openRetainedMediaMigration(target);
  })
    .then(({ output, exitCode }) => {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(
        '{"error":"ENTRY","message":"Consult the same job before retrying"}\n',
      );
      process.exitCode = 1;
    });
}
