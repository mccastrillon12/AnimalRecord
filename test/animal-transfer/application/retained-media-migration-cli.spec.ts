import type { MediaMigration } from '../../../src/context/animal-media/domain/legacy-media-migration';
import { runRetainedMediaMigration } from '../../../src/operations/retained-media-migration.cli';

const id = '123e4567-e89b-42d3-a456-426614174020';
const animalId = '123e4567-e89b-42d3-a456-426614174010';
const ownerId = '123e4567-e89b-42d3-a456-426614174001';
const requestId = '123e4567-e89b-42d3-a456-426614174030';
const database = 'synthetic-db';
const bucket = 'synthetic-media';
const target = [database, bucket, id];
const job: MediaMigration = {
  id,
  animalId,
  ownerId,
  ownershipVersion: 1,
  revision: 3,
  phase: 'DIARY',
  retention: {
    bucket,
    expectedBucketOwner: '123456789012',
    retainUntil: '2090-01-01T00:00:00.000Z',
  },
};
const setup = () => {
  const migration = {
    start: jest.fn().mockResolvedValue(job),
    observe: jest.fn().mockResolvedValue(job),
    migrateBatch: jest.fn().mockResolvedValue(job),
    stopForRecovery: jest
      .fn()
      .mockResolvedValue({ ...job, phase: 'STOPPED', revision: 4 }),
  };
  const verifyBucket = jest.fn().mockResolvedValue(undefined);
  const verifyIndexes = jest.fn().mockResolvedValue(undefined);
  const close = jest.fn().mockResolvedValue(undefined);
  const open = jest
    .fn()
    .mockResolvedValue({ migration, verifyBucket, verifyIndexes, close });
  return { open, migration, verifyBucket, verifyIndexes, close };
};

it('validates arguments and prints help before opening a connection', async () => {
  const { open } = setup();
  await expect(
    runRetainedMediaMigration(['--help'], open),
  ).resolves.toMatchObject({ exitCode: 0 });
  for (const args of [
    ['advance', ...target],
    ['status', ...target, '--execute'],
    [
      'start',
      ...target,
      animalId,
      ownerId,
      '0',
      'media',
      '123456789012',
      '2090-01-01T00:00:00.000Z',
      '--execute',
    ],
    [
      'stop',
      ...target,
      '-1',
      requestId,
      ownerId,
      'OPERATOR_INTERVENTION',
      'incident-1',
      '--execute',
    ],
  ]) {
    await expect(runRetainedMediaMigration(args, open)).resolves.toMatchObject({
      exitCode: 2,
    });
  }
  expect(open).not.toHaveBeenCalled();
});

it('does not reserve a job if the bucket preflight fails and closes the connection', async () => {
  const { open, migration, verifyBucket, close } = setup();
  verifyBucket.mockRejectedValueOnce(new Error('private provider detail'));
  const result = await runRetainedMediaMigration(
    [
      'start',
      ...target,
      animalId,
      ownerId,
      '1',
      'medical',
      '123456789012',
      '2090-01-01T00:00:00.000Z',
      '--execute',
    ],
    open,
  );
  expect(result).toMatchObject({
    exitCode: 1,
    output: { error: 'S3_CONFIGURATION' },
  });
  expect(JSON.stringify(result)).not.toContain('private provider detail');
  expect(migration.start).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it('rejects jobs from a different bucket before advancing or stopping', async () => {
  const { open, migration } = setup();
  migration.observe.mockResolvedValue({
    ...job,
    retention: { ...job.retention, bucket: 'other-bucket' },
  });
  await expect(
    runRetainedMediaMigration(['advance', ...target, '--execute'], open),
  ).resolves.toMatchObject({
    exitCode: 1,
    output: { error: 'STATUS' },
  });
  expect(migration.migrateBatch).not.toHaveBeenCalled();
  expect(migration.stopForRecovery).not.toHaveBeenCalled();
});

it('passes the expected revision and audit details to the existing recovery without accessing S3', async () => {
  const { open, migration, verifyBucket } = setup();
  await expect(
    runRetainedMediaMigration(
      [
        'stop',
        ...target,
        '3',
        requestId,
        ownerId,
        'OPERATOR_INTERVENTION',
        'incident-1',
        '--execute',
      ],
      open,
    ),
  ).resolves.toMatchObject({
    exitCode: 0,
    output: { phase: 'STOPPED', revision: 4 },
  });
  expect(migration.stopForRecovery).toHaveBeenCalledWith({
    id,
    expectedRevision: 3,
    requestId,
    operatorId: ownerId,
    reason: 'OPERATOR_INTERVENTION',
    evidenceRef: 'incident-1',
  });
  expect(verifyBucket).not.toHaveBeenCalled();
});
