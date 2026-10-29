import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import {
  PromotionConfirmMongoFixture,
  CONFIRM_BYTES,
  CONFIRM_REVISION,
} from './support/media-promotion-confirm-mongo-fixture';
import { readPromotionConfirmMongoSettings } from './support/media-promotion-confirm-mongo-safety';
import { MongoMediaPromotionReadiness } from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-readiness';
import { MongoMediaPromotionIndexMaintenance } from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-index-maintenance';
import { Test } from '@nestjs/testing';
import { AnimalMediaUploads } from '../../../src/context/animal-media/application/animal-media-uploads';
import { AnimalMediaUploadStorage } from '../../../src/context/animal-media/domain/animal-media-upload';
import {
  AnimalMediaPromotionConfirmation,
  PromotionConfirmationCall,
} from '../../../src/context/animal-media/domain/media-promotion-confirmation-runner';
import {
  MEDIA_PROMOTION_MONGO_BINDING,
  preparePromotionConfirmationProvider,
  PromotionConfirmationSelection,
} from '../../../src/app/animal-media/media-promotion-confirmation.provider';
import { PromotionMongoBinding } from '../../../src/context/animal-media/infrastructure/prepare-media-promotion-confirmation';
import { bounded, deferred } from './support/write-race-gate';

type Seed = Awaited<
  ReturnType<PromotionConfirmMongoFixture['seedConfirmation']>
>;
describe('Opt-in complete confirmation with real Mongo/SDK and synthetic native S3', () => {
  let f: PromotionConfirmMongoFixture;
  beforeEach(async () => {
    f = new PromotionConfirmMongoFixture();
    await f.open(readPromotionConfirmMongoSettings(process.env));
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(async () => {
    try {
      await f.close();
      expect(f.transport.steps).toHaveLength(0);
    } finally {
      jest.restoreAllMocks();
    }
  });
  function verification(s: Seed) {
    f.transport.steps.push(
      { method: 'HEAD', respond: s.head },
      { method: 'GET', respond: () => s.get() },
      { method: 'HEAD', respond: s.head },
    );
  }
  function prefix(s: Seed) {
    f.transport.steps.push(
      { method: 'HEAD', respond: s.absent },
      { method: 'PUT', respond: () => xmlResponse() },
    );
  }
  async function unsealed(s: Seed) {
    expect(
      (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
    ).toBeUndefined();
    expect(await f.right.records.countDocuments({ kind: 'OBSERVATION' })).toBe(
      0,
    );
  }
  async function revoke(s: Seed) {
    const read = await f.right.repository.read(s.selection);
    await f.right.repository.revoke(s.selection, read.gate!.gateRevision, {
      requestId: s.id(50),
      operatorId: s.id(51),
      evidenceRef: 'test:confirmation-revoked',
    });
  }

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    '%s grants before PUT and commits MATCH/seal/fences together',
    async (kind) => {
      const s = await f.seedConfirmation(kind);
      prefix(s);
      verification(s);
      await f.runtime().confirm(s.input);
      expect(f.transport.requests.map((r) => r.method)).toEqual([
        'HEAD',
        'PUT',
        'HEAD',
        'GET',
        'HEAD',
      ]);
      expect(f.delegatedPermissions).toHaveLength(1);
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(CONFIRM_REVISION);
      expect(
        (await f.right.repository.read(s.selection, s.input.observationId))
          .record,
      ).toMatchObject({ kind: 'OBSERVATION', data: { finding: 'MATCH' } });
      expect(
        await f.right.records.countDocuments({
          kind: 'RESPONSE',
          'data.outcome': 'UNKNOWN',
        }),
      ).toBe(1);
      const txs = [
        ['update', 'animal_write_journals'],
        ['update', 'animal_ownership_controls'],
        ['update', 'animal_media_uploads'],
        ['insert', 'animal_media_promotion_records'],
        ['update', 'animal_media_promotion_records'],
      ].map(
        ([command, collection]) =>
          f.commands
            .filter(
              (c) =>
                c.side === 'left' &&
                c.command === command &&
                c.collection === collection,
            )
            .at(-1)?.transaction,
      );
      expect(txs[0]).toBeDefined();
      expect(new Set(txs).size).toBe(1);
      expect(
        f.commands.some(
          (c) =>
            c.transaction === txs[0] &&
            c.command === 'commitTransaction' &&
            c.majority,
        ),
      ).toBe(true);
      expect(
        f.commands.some((c) => c.transaction === txs[0] && c.snapshot),
      ).toBe(true);
      expect((await f.snapshot()).control!.activeWrites).toHaveLength(1);
    },
  );

  it('verifies an existing final without granting or attributing a copy', async () => {
    const s = await f.seedConfirmation();
    f.transport.steps.push({ method: 'HEAD', respond: s.head });
    verification(s);
    await f.runtime().confirm(s.input);
    expect(f.delegatedPermissions).toHaveLength(0);
    expect(await f.right.records.countDocuments({ kind: 'ATTEMPT' })).toBe(0);
    expect(await f.right.records.countDocuments({ kind: 'RESPONSE' })).toBe(0);
    expect(
      (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
    ).toEqual(CONFIRM_REVISION);
  });

  it.each(['PUT', 'HEAD', 'GET'] as const)(
    'SDK %s retry preserves the full-cycle protocol',
    async (method) => {
      const s = await f.seedConfirmation();
      if (method === 'HEAD')
        f.transport.steps.push({
          method,
          respond: () => xmlResponse(503, 'SlowDown'),
        });
      f.transport.steps.push({ method: 'HEAD', respond: s.absent });
      if (method === 'PUT')
        f.transport.steps.push({
          method,
          respond: () => xmlResponse(503, 'SlowDown'),
        });
      f.transport.steps.push(
        { method: 'PUT', respond: () => xmlResponse() },
        { method: 'HEAD', respond: s.head },
      );
      if (method === 'GET')
        f.transport.steps.push({
          method,
          respond: () => {
            throw Object.assign(new Error('synthetic reset'), {
              code: 'ECONNRESET',
            });
          },
        });
      f.transport.steps.push(
        { method: 'GET', respond: () => s.get() },
        { method: 'HEAD', respond: s.head },
      );
      await f.runtime(2).confirm(s.input);
      const count = method === 'PUT' ? 2 : 1;
      expect(f.delegatedPermissions).toHaveLength(count);
      expect(new Set(f.delegatedPermissions).size).toBe(count);
      expect(await f.right.records.countDocuments({ kind: 'ATTEMPT' })).toBe(
        count,
      );
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(CONFIRM_REVISION);
    },
  );

  it.each([409, 412])(
    'SDK %s reconciles only by verification with the first permission retained',
    async (status) => {
      const s = await f.seedConfirmation();
      f.transport.steps.push(
        { method: 'HEAD', respond: s.absent },
        {
          method: 'PUT',
          respond: () => xmlResponse(status, 'PreconditionFailed'),
        },
      );
      verification(s);
      await f.runtime().confirm(s.input);
      expect(f.delegatedPermissions).toHaveLength(1);
      expect(
        await f.right.records.countDocuments({
          kind: 'ATTEMPT',
          authorizationId: { $exists: true },
        }),
      ).toBe(1);
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(CONFIRM_REVISION);
    },
  );

  it('an uncertain copy stops without automatic verification or replay', async () => {
    const s = await f.seedConfirmation();
    f.transport.steps.push(
      { method: 'HEAD', respond: s.absent },
      { method: 'PUT', respond: () => xmlResponse(500, 'InternalError') },
    );
    await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
      stage: 'DISPATCH',
      reason: 'UNCERTAIN',
    });
    await unsealed(s);
    expect(f.delegatedPermissions).toHaveLength(1);
    expect(f.transport.requests.map((r) => r.method)).toEqual(['HEAD', 'PUT']);
  });

  it('wrong bytes after a successful send never seal or discharge its permission', async () => {
    const s = await f.seedConfirmation();
    prefix(s);
    f.transport.steps.push(
      { method: 'HEAD', respond: s.head },
      {
        method: 'GET',
        respond: () => s.get(Buffer.alloc(CONFIRM_BYTES.length, 'b')),
      },
    );
    await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: 'CONFLICT',
    });
    await unsealed(s);
    expect(f.delegatedPermissions).toHaveLength(1);
  });

  it.each(['revoke', 'token'] as const)(
    '%s during preflight denies a new permission',
    async (mode) => {
      const s = await f.seedConfirmation(),
        pause = f.transport.pause('HEAD', s.absent());
      const pending = f.observe(f.runtime().confirm(s.input));
      await pause.entered();
      if (mode === 'revoke') await revoke(s);
      else
        await f.right.controls.updateOne(
          { animalId: s.selection.animalId },
          { $pull: { activeWrites: { token: s.selection.operationId } } },
          { writeConcern: { w: 'majority' } },
        );
      pause.release();
      expect(await pending).toHaveProperty('error');
      await unsealed(s);
      expect(f.delegatedPermissions).toHaveLength(0);
      expect(f.transport.requests).toHaveLength(1);
    },
  );

  it.each(['revoke', 'settle'] as const)(
    '%s during GET prevents seal without erasing prior grants',
    async (mode) => {
      const s = await f.seedConfirmation();
      prefix(s);
      f.transport.steps.push({ method: 'HEAD', respond: s.head });
      const pause = f.transport.pause('GET', s.get());
      f.transport.steps.push({ method: 'HEAD', respond: s.head });
      const pending = f.observe(f.runtime().confirm(s.input));
      await pause.entered();
      if (mode === 'revoke') await revoke(s);
      else
        await f.right.journal.settleCallback(
          s.handle,
          'THREW',
          s.upload.createdAt,
        );
      pause.release();
      expect(await pending).toMatchObject({
        error: { stage: 'SEAL', reason: 'CONFLICT' },
      });
      await unsealed(s);
      expect(
        await f.right.records.countDocuments({
          kind: 'ATTEMPT',
          authorizationId: { $exists: true },
        }),
      ).toBe(1);
    },
  );

  it.each([
    'OPEN',
    'DECLARE_EFFECT',
    'AUTHORIZE_ATTEMPT',
    'RECORD_RESPONSE',
    'SEAL',
  ] as const)(
    'lost %s application reply after recognized commit is never adopted',
    async (lost) => {
      const s = await f.seedConfirmation();
      if (lost === 'OPEN') f.loseNextCommitReply(f.left);
      else if (lost !== 'SEAL') {
        const apply = f.left.repository.apply.bind(f.left.repository);
        jest
          .spyOn(f.left.repository, 'apply')
          .mockImplementation((selection, revision, command) => {
            if (command.type === lost) f.loseNextCommitReply(f.left);
            return apply(selection, revision, command);
          });
      }
      if (['AUTHORIZE_ATTEMPT', 'RECORD_RESPONSE', 'SEAL'].includes(lost))
        f.transport.steps.push({ method: 'HEAD', respond: s.absent });
      if (lost === 'RECORD_RESPONSE' || lost === 'SEAL')
        f.transport.steps.push({ method: 'PUT', respond: () => xmlResponse() });
      if (lost === 'SEAL')
        f.transport.steps.push(
          { method: 'HEAD', respond: s.head },
          { method: 'GET', respond: () => s.get() },
          {
            method: 'HEAD',
            respond: () => {
              f.loseNextCommitReply(f.left);
              return s.head();
            },
          },
        );
      await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
        reason: 'UNCERTAIN',
      });
      const before = await f.snapshot();
      if (lost === 'SEAL') {
        expect(before.uploads[0].sealed).toEqual(CONFIRM_REVISION);
        expect(
          (await f.right.repository.read(s.selection, s.input.observationId))
            .record,
        ).toMatchObject({ kind: 'OBSERVATION', data: { finding: 'MATCH' } });
      } else await unsealed(s);
      const grantCount = [
        'AUTHORIZE_ATTEMPT',
        'RECORD_RESPONSE',
        'SEAL',
      ].includes(lost)
        ? 1
        : 0;
      expect(
        await f.right.records.countDocuments({
          kind: 'ATTEMPT',
          authorizationId: { $exists: true },
        }),
      ).toBe(grantCount);
      await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
        stage: 'OPEN',
        reason: 'CONFLICT',
      });
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it('a final gate CAS failure rolls back MATCH/seal/fences but retains the send evidence', async () => {
    const s = await f.seedConfirmation();
    prefix(s);
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    f.transport.steps.push(
      { method: 'HEAD', respond: s.head },
      { method: 'GET', respond: () => s.get() },
      {
        method: 'HEAD',
        respond: async () => {
          before = await f.snapshot();
          f.left.gate.failGateCas = true;
          return s.head();
        },
      },
    );
    await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
      stage: 'SEAL',
      reason: 'CONFLICT',
    });
    expect(await f.snapshot()).toEqual(before);
    await unsealed(s);
    expect(f.delegatedPermissions).toHaveLength(1);
  });

  it('a fresh cycle cannot adopt a previous successful operation', async () => {
    const s = await f.seedConfirmation();
    prefix(s);
    verification(s);
    await f.runtime().confirm(s.input);
    const before = await f.snapshot(),
      sends = f.transport.requests.length;
    await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(await f.snapshot()).toEqual(before);
    expect(f.transport.requests).toHaveLength(sends);
  });

  it('an unmarked journal created without opt-in is not retrofitted at MAY_RUN', async () => {
    const s = await f.seedConfirmation('PROFILE_CONFIRM', false),
      before = await f.snapshot();
    await expect(f.runtime().confirm(s.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(await f.snapshot()).toEqual(before);
    expect(f.transport.requests).toHaveLength(0);
  });

  // Prepared only. Running this suite still requires its own authorized Mongo environment.
  const inspector = (expected = f.namespace.databaseName) =>
    new MongoMediaPromotionReadiness(f.left.connection.db!, expected);
  async function dropRequiredIndex(key: Record<string, number>) {
    const indexes = (await f.left.records.collection
      .listIndexes()
      .toArray()) as Array<{
      key: Record<string, unknown>;
      name?: string;
    }>;
    const index = indexes.find(
      (i) => JSON.stringify(i.key) === JSON.stringify(key),
    );
    if (!index || typeof index.name !== 'string')
      throw new Error('Required fixture index missing');
    await f.left.records.collection.dropIndex(index.name, {
      writeConcern: { w: 'majority' },
    });
  }
  it('readiness observes all 14 indexes through metadata only, without opening a gate or acquiring permission', async () => {
    const start = f.commands.length;
    const report = await inspector().inspect();
    expect(report).toMatchObject({
      status: 'SATISFIED',
      transactions: 'NOT_PROBED',
      data: 'NOT_ASSESSED',
      activation: 'DISABLED',
      issues: [],
    });
    const observed = f.commands.slice(start);
    expect(observed.map((c) => c.command)).toEqual([
      'hello',
      'listCollections',
      'listIndexes',
      'listIndexes',
      'listIndexes',
      'listIndexes',
    ]);
    expect(observed.every((c) => c.transaction === undefined)).toBe(true);
    expect(await f.right.records.countDocuments()).toBe(0);
    expect(f.transport.requests).toHaveLength(0);
  });
  it('readiness reports a missing unique identity index without installing it', async () => {
    await dropRequiredIndex({ identityIds: 1 });
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'INDEX_MISSING',
      collection: 'animal_media_promotion_records',
      requirementId: 'PROMOTION_IDENTITIES',
    });
    expect(
      (await f.left.records.collection.listIndexes().toArray()).some(
        (i: { key: Record<string, unknown> }) => i.key.identityIds === 1,
      ),
    ).toBe(false);
  });
  it('readiness rejects a sparse replacement of the unique identity index', async () => {
    await dropRequiredIndex({ identityIds: 1 });
    await f.left.connection
      .db!.collection('animal_media_promotion_records', {
        writeConcern: { w: 'majority' },
      })
      .createIndex({ identityIds: 1 }, { unique: true, sparse: true });
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'INDEX_OPTIONS',
      collection: 'animal_media_promotion_records',
      requirementId: 'PROMOTION_IDENTITIES',
    });
  });
  it('readiness reports TTL in its own journal fixture without removing it', async () => {
    await f.left.connection
      .db!.collection('animal_write_journals', {
        writeConcern: { w: 'majority' },
      })
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'TTL_PRESENT',
      collection: 'animal_write_journals',
    });
    expect(
      (await f.left.journals.collection.listIndexes().toArray()).some(
        (i: { expireAfterSeconds?: unknown }) => i.expireAfterSeconds === 60,
      ),
    ).toBe(true);
  });
  it('readiness rejects a different real partial filter without changing it', async () => {
    await dropRequiredIndex({ operationId: 1, uploadId: 1 });
    await f.left.connection
      .db!.collection('animal_media_promotion_records', {
        writeConcern: { w: 'majority' },
      })
      .createIndex(
        { operationId: 1, uploadId: 1 },
        {
          unique: true,
          partialFilterExpression: { kind: 'ATTEMPT' },
        },
      );
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'INDEX_OPTIONS',
      collection: 'animal_media_promotion_records',
      requirementId: 'PROMOTION_UPLOAD',
    });
  });
  it('readiness reports an absent fixture collection without recreating it', async () => {
    await f.left.records.collection.drop({ writeConcern: { w: 'majority' } });
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'COLLECTION_MISSING',
      collection: 'animal_media_promotion_records',
    });
    expect(
      await f.left.connection
        .db!.listCollections(
          { name: 'animal_media_promotion_records' },
          { nameOnly: true },
        )
        .toArray(),
    ).toHaveLength(0);
  });
  it('readiness reports an extra real uniqueness constraint without dropping it', async () => {
    await f.left.connection
      .db!.collection('animal_media_promotion_records', {
        writeConcern: { w: 'majority' },
      })
      .createIndex({ arbitrary: 1 }, { unique: true });
    expect((await inspector().inspect()).issues).toContainEqual({
      code: 'UNREVIEWED_UNIQUE_INDEX',
      collection: 'animal_media_promotion_records',
    });
  });
  it('readiness rejects a wrong target before issuing metadata commands', async () => {
    const start = f.commands.length;
    await expect(inspector('wrong-target').inspect()).rejects.toMatchObject({
      stage: 'TARGET',
    });
    expect(f.commands).toHaveLength(start);
    expect(f.transport.requests).toHaveLength(0);
  });

  const maintenance = () =>
    new MongoMediaPromotionIndexMaintenance(
      f.left.connection.db!,
      f.namespace.databaseName,
    ).operator();
  it('index maintenance observes an already satisfied catalog and applies no DDL', async () => {
    const op = maintenance(),
      plan = await op.prepare(),
      start = f.commands.length;
    expect(plan.status).toBe('NO_CHANGES');
    const result = await op.apply({
      databaseName: f.namespace.databaseName,
      reviewedPlanId: plan.planId,
    });
    expect(result.acknowledgedActionIds).toEqual([]);
    expect(result.report.activation).toBe('DISABLED');
    expect(
      f.commands
        .slice(start)
        .every((c) =>
          ['hello', 'listCollections', 'listIndexes'].includes(c.command),
        ),
    ).toBe(true);
  });
  it('index maintenance installs one missing unique index and an explicit later plan is idempotent', async () => {
    await dropRequiredIndex({ identityIds: 1 });
    const op = maintenance(),
      plan = await op.prepare();
    expect(plan.actions.map((a) => a.id)).toEqual(['PROMOTION_IDENTITIES']);
    const result = await op.apply({
      databaseName: f.namespace.databaseName,
      reviewedPlanId: plan.planId,
    });
    expect(result.acknowledgedActionIds).toEqual(['PROMOTION_IDENTITIES']);
    expect(result.report.status).toBe('SATISFIED');
    expect((await maintenance().prepare()).status).toBe('NO_CHANGES');
  });
  it('index maintenance creates only the absent ordinary collection and its declared indexes', async () => {
    await f.left.records.collection.drop({ writeConcern: { w: 'majority' } });
    const op = maintenance(),
      plan = await op.prepare();
    expect(plan.actions).toHaveLength(7);
    expect(plan.actions[0].type).toBe('CREATE_COLLECTION');
    const result = await op.apply({
      databaseName: f.namespace.databaseName,
      reviewedPlanId: plan.planId,
    });
    expect(result.report.status).toBe('SATISFIED');
    expect(result.acknowledgedActionIds).toHaveLength(7);
    expect(await f.right.records.countDocuments()).toBe(0);
  });
  it('index maintenance rejects a reviewed plan after external catalog drift without adding anything', async () => {
    await dropRequiredIndex({ identityIds: 1 });
    const op = maintenance(),
      plan = await op.prepare();
    await dropRequiredIndex({ id: 1 });
    const start = f.commands.length;
    await expect(
      op.apply({
        databaseName: f.namespace.databaseName,
        reviewedPlanId: plan.planId,
      }),
    ).rejects.toMatchObject({ stage: 'REVIEW', reason: 'CHANGED' });
    expect(
      f.commands
        .slice(start)
        .some((c) => ['createIndexes', 'create'].includes(c.command)),
    ).toBe(false);
  });
  it('index maintenance leaves TTL and missing indexes untouched when remediation is blocked', async () => {
    await dropRequiredIndex({ identityIds: 1 });
    await f.left.connection
      .db!.collection('animal_write_journals', {
        writeConcern: { w: 'majority' },
      })
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
    const op = maintenance(),
      plan = await op.prepare(),
      start = f.commands.length;
    expect(plan.status).toBe('BLOCKED');
    expect(plan.actions).toHaveLength(0);
    await expect(
      op.apply({
        databaseName: f.namespace.databaseName,
        reviewedPlanId: plan.planId,
      }),
    ).rejects.toMatchObject({ stage: 'REVIEW', reason: 'BLOCKED' });
    expect(
      f.commands
        .slice(start)
        .every((c) =>
          ['hello', 'listCollections', 'listIndexes'].includes(c.command),
        ),
    ).toBe(true);
  });
  it('index maintenance never repairs duplicate data after unique creation fails', async () => {
    await dropRequiredIndex({ id: 1 });
    // Deliberately invalid fixture documents, only in this test namespace.
    await f.left.records.collection.insertMany(
      [
        { id: 'duplicate-fixture', identityIds: ['unique-fixture-a'] },
        { id: 'duplicate-fixture', identityIds: ['unique-fixture-b'] },
      ],
      { writeConcern: { w: 'majority' } },
    );
    const op = maintenance(),
      plan = await op.prepare();
    await expect(
      op.apply({
        databaseName: f.namespace.databaseName,
        reviewedPlanId: plan.planId,
      }),
    ).rejects.toMatchObject({
      stage: 'APPLY',
      reason: 'UNCERTAIN',
      actionId: 'PROMOTION_ID',
      acknowledgedActionIds: [],
    });
    expect(
      await f.right.records.countDocuments({ id: 'duplicate-fixture' }),
    ).toBe(2);
    await expect(
      op.apply({
        databaseName: f.namespace.databaseName,
        reviewedPlanId: plan.planId,
      }),
    ).rejects.toMatchObject({ stage: 'LIFECYCLE' });
  });

  // Prepared only: reuse the same namespace, two clients, opt-in and native transport.
  function selectedConfiguration(
    maxAttempts = 1,
  ): Extract<PromotionConfirmationSelection, { mode: 'PROMOTION_ROWS_V1' }> {
    return {
      mode: 'PROMOTION_ROWS_V1',
      expectedDatabaseName: f.namespace.databaseName,
      aws: {
        bucket: 'animalrecord-test-media',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'SYNTHETIC',
          secretAccessKey: 'synthetic-secret',
        },
        maxAttempts,
      },
    };
  }
  async function assembled(
    s: Seed,
    selection: PromotionConfirmationSelection = selectedConfiguration(),
    binding: PromotionMongoBinding = f.left,
  ) {
    const descriptor = preparePromotionConfirmationProvider(selection);
    const original = descriptor.useFactory;
    let observedCall: Readonly<PromotionConfirmationCall> | undefined;
    const storage = {
      keyFromUrl: () => s.upload.finalKey,
      urlForKey: jest.fn(),
      signStaging: jest.fn(),
      describeSource: jest.fn(),
      pinSource: jest.fn(),
      promote: jest.fn(),
      verifyFinal: jest.fn(),
    } satisfies AnimalMediaUploadStorage;
    const seal = jest.spyOn(f.left.uploadRepository, 'seal');
    const module = await Test.createTestingModule({
      providers: [
        AnimalMediaUploads,
        {
          provide: 'AnimalMediaUploadRepository',
          useValue: f.left.uploadRepository,
        },
        { provide: 'AnimalMediaUploadStorage', useValue: storage },
        { provide: MEDIA_PROMOTION_MONGO_BINDING, useValue: binding },
        {
          ...descriptor,
          useFactory: async (actual: PromotionMongoBinding) => {
            const port = await original(actual);
            if (!port) return undefined;
            return {
              confirm: (call: PromotionConfirmationCall) => {
                observedCall = s.observeCall(call);
                return port.confirm(call);
              },
            } satisfies AnimalMediaPromotionConfirmation;
          },
        },
      ],
    }).compile();
    try {
      await module.init();
    } catch (error) {
      await module.close();
      throw error;
    }
    const confirm = () =>
      module
        .get(AnimalMediaUploads)
        .confirm(
          s.upload.ownerId,
          s.animalId,
          'https://synthetic.invalid/media',
          s.upload.mimeType,
          s.upload.size,
          undefined,
          s.input.scope,
        );
    return { module, storage, seal, confirm, call: () => observedCall };
  }
  function nativeHandle() {
    return f.left.uploads.collection as unknown as { collection: unknown };
  }
  const rightNative = () =>
    (f.right.uploads.collection as unknown as { collection: unknown })
      .collection;

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'selected Nest/shared bridge confirms %s with persisted backend IDs and no old promotion',
    async (kind) => {
      const s = await f.seedConfirmation(kind),
        start = f.commands.length;
      const a = await assembled(s);
      try {
        expect(f.commands.slice(start).map((c) => c.command)).toEqual([
          'hello',
          'listCollections',
          'listIndexes',
          'listIndexes',
          'listIndexes',
          'listIndexes',
        ]);
        expect(f.transport.requests).toHaveLength(0);
        prefix(s);
        verification(s);
        await a.confirm();
        expect(f.transport.requests.map((r) => r.method)).toEqual([
          'HEAD',
          'PUT',
          'HEAD',
          'GET',
          'HEAD',
        ]);
        const call = a.call()!;
        expect(call.effectId).not.toBe(s.input.effectId);
        expect(
          (await f.right.repository.read(s.selection, call.observationId))
            .record,
        ).toMatchObject({
          kind: 'OBSERVATION',
          effectId: call.effectId,
          data: { finding: 'MATCH' },
        });
        expect(
          (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
        ).toEqual(CONFIRM_REVISION);
        expect(f.delegatedPermissions).toHaveLength(1);
        expect(a.storage.promote).not.toHaveBeenCalled();
        expect(a.seal).not.toHaveBeenCalled();
        expect((await f.snapshot()).journal!.callback).toBe('MAY_RUN');
      } finally {
        await a.module.close();
      }
    },
  );
  it('CURRENT selection preserves the old storage port and does not inspect prerequisites or create a gate', async () => {
    const s = await f.seedConfirmation(),
      start = f.commands.length;
    const a = await assembled(s, { mode: 'CURRENT' });
    try {
      expect(f.commands).toHaveLength(start);
      a.storage.promote.mockResolvedValue(CONFIRM_REVISION);
      await a.confirm();
      expect(a.storage.promote).toHaveBeenCalledTimes(1);
      expect(a.seal).toHaveBeenCalledTimes(1);
      expect(await f.right.records.countDocuments()).toBe(0);
      expect(f.transport.requests).toHaveLength(0);
    } finally {
      await a.module.close();
    }
  });
  it('selected startup rejects a wrong expected database before issuing metadata commands', async () => {
    const s = await f.seedConfirmation(),
      start = f.commands.length;
    await expect(
      assembled(s, {
        ...selectedConfiguration(),
        expectedDatabaseName: 'wrong-target',
      }),
    ).rejects.toMatchObject({ stage: 'BINDING' });
    expect(f.commands).toHaveLength(start);
    expect(f.transport.requests).toHaveLength(0);
  });
  it('selected startup rejects mixed models from its two real clients in the same namespace', async () => {
    const s = await f.seedConfirmation(),
      start = f.commands.length;
    await expect(
      assembled(s, selectedConfiguration(), {
        ...f.left,
        uploads: f.right.uploads,
      }),
    ).rejects.toMatchObject({ stage: 'BINDING' });
    expect(f.commands).toHaveLength(start);
    expect(f.transport.requests).toHaveLength(0);
  });
  it('selected startup rejects a native handle from the other client without touching another namespace', async () => {
    const s = await f.seedConfirmation(),
      handle = nativeHandle(),
      original = handle.collection,
      start = f.commands.length;
    try {
      handle.collection = rightNative();
      await expect(assembled(s)).rejects.toMatchObject({ stage: 'BINDING' });
      expect(f.commands).toHaveLength(start);
      expect(f.transport.requests).toHaveLength(0);
    } finally {
      handle.collection = original;
    }
  });
  it('selected startup refuses a missing index without automatically installing or choosing CURRENT', async () => {
    const s = await f.seedConfirmation();
    await dropRequiredIndex({ identityIds: 1 });
    const start = f.commands.length;
    await expect(assembled(s)).rejects.toMatchObject({ stage: 'REQUIREMENTS' });
    expect(
      f.commands
        .slice(start)
        .every((c) =>
          ['hello', 'listCollections', 'listIndexes'].includes(c.command),
        ),
    ).toBe(true);
    expect((await inspector().inspect()).status).toBe('BLOCKED');
    expect(f.transport.requests).toHaveLength(0);
  });
  it('selected startup metadata never permits adopting a journal created without the opt-in', async () => {
    const s = await f.seedConfirmation('PROFILE_CONFIRM', false),
      before = await f.snapshot();
    const a = await assembled(s);
    try {
      await expect(a.confirm()).rejects.toMatchObject({
        stage: 'OPEN',
        reason: 'CONFLICT',
      });
      expect(await f.snapshot()).toEqual(before);
      expect(f.transport.requests).toHaveLength(0);
      expect(a.storage.promote).not.toHaveBeenCalled();
      expect(a.seal).not.toHaveBeenCalled();
    } finally {
      await a.module.close();
    }
  });
  it('selected startup rechecks a native handle changed after the real metadata inspection', async () => {
    const s = await f.seedConfirmation(),
      entered = deferred(),
      release = deferred();
    const handle = nativeHandle(),
      originalHandle = handle.collection;
    // The original is explicitly invoked with call(this) below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const inspect = MongoMediaPromotionReadiness.prototype.inspect;
    const spy = jest
      .spyOn(MongoMediaPromotionReadiness.prototype, 'inspect')
      .mockImplementationOnce(async function (
        this: MongoMediaPromotionReadiness,
      ) {
        const report = await inspect.call(this);
        entered.resolve();
        await bounded(release.promise, 'assembly metadata release');
        return report;
      });
    const pending = f.observe(assembled(s));
    try {
      await bounded(entered.promise, 'assembly metadata entered');
      handle.collection = rightNative();
      release.resolve();
      expect(await pending).toMatchObject({ error: { stage: 'BINDING' } });
      expect(f.transport.requests).toHaveLength(0);
    } finally {
      release.resolve();
      const result = await pending;
      handle.collection = originalHandle;
      spy.mockRestore();
      if ('value' in result) await result.value.module.close();
    }
  });
  it('selected confirmation rejects native rebinding after preparation and never invokes the old copy', async () => {
    const s = await f.seedConfirmation(),
      a = await assembled(s),
      handle = nativeHandle(),
      original = handle.collection;
    const before = await f.snapshot();
    try {
      handle.collection = rightNative();
      await expect(a.confirm()).rejects.toMatchObject({
        stage: 'INPUT',
        reason: 'UNAVAILABLE',
      });
      handle.collection = original;
      expect(await f.snapshot()).toEqual(before);
      expect(f.transport.requests).toHaveLength(0);
      expect(a.storage.promote).not.toHaveBeenCalled();
      expect(a.seal).not.toHaveBeenCalled();
    } finally {
      handle.collection = original;
      await a.module.close();
    }
  });
  it('selected uncertain copy retains its permission and private call correlation without fallback', async () => {
    const s = await f.seedConfirmation(),
      a = await assembled(s);
    try {
      f.transport.steps.push(
        { method: 'HEAD', respond: s.absent },
        { method: 'PUT', respond: () => xmlResponse(500, 'InternalError') },
      );
      await expect(a.confirm()).rejects.toMatchObject({
        stage: 'DISPATCH',
        reason: 'UNCERTAIN',
        receipt: {
          operationId: s.input.scope.operationId,
          uploadId: s.upload.id,
        },
      });
      await unsealed(s);
      expect(f.delegatedPermissions).toHaveLength(1);
      expect(a.storage.promote).not.toHaveBeenCalled();
      expect(a.seal).not.toHaveBeenCalled();
      expect(
        await f.right.records.countDocuments({
          kind: 'ATTEMPT',
          effectId: a.call()!.effectId,
          authorizationId: { $exists: true },
        }),
      ).toBe(1);
    } finally {
      await a.module.close();
    }
  });
  it('selected SDK PUT retry obtains separate committed permissions under the backend call IDs', async () => {
    const s = await f.seedConfirmation(),
      a = await assembled(s, selectedConfiguration(2));
    try {
      f.transport.steps.push(
        { method: 'HEAD', respond: s.absent },
        { method: 'PUT', respond: () => xmlResponse(503, 'SlowDown') },
        { method: 'PUT', respond: () => xmlResponse() },
      );
      verification(s);
      await a.confirm();
      expect(f.delegatedPermissions).toHaveLength(2);
      expect(new Set(f.delegatedPermissions).size).toBe(2);
      expect(
        await f.right.records.countDocuments({
          kind: 'ATTEMPT',
          effectId: a.call()!.effectId,
        }),
      ).toBe(2);
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(CONFIRM_REVISION);
      expect(a.storage.promote).not.toHaveBeenCalled();
      expect(a.seal).not.toHaveBeenCalled();
    } finally {
      await a.module.close();
    }
  });
});
