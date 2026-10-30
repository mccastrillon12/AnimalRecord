import {
  assessTransferFlowMongo,
  FLOW_REQUIREMENTS,
} from '../../../src/context/animal-transfer/domain/transfer-flow-mongo-requirements';
import {
  completeFlowMetadata,
  flowAt,
  flowTarget,
} from '../fixtures/transfer-flow-requirements.fixture';
import { UserSchema } from '../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import { AnimalSchema } from '../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { AnimalTransferReasonSchema } from '../../../src/context/catalogs/infrastructure/persistence/mongo/catalogs.schema';
import { TransferOtpSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp';
import { TRANSFER_REQUEST_MODELS } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  NotificationDeviceSchema,
  NotificationDeviceTokenSchema,
} from '../../../src/context/notification/infrastructure/mongo-notification-devices';
import {
  PushDeliverySchema,
  PushAttemptSchema,
} from '../../../src/context/notification/infrastructure/notification-push.schema';

describe('Versioned operational requirements, no Mongo access', () => {
  it('pins all fifteen collection/index declarations, including shared sparse uniqueness, without deriving its manifest dynamically', () => {
    const schemas = [
      UserSchema,
      AnimalSchema,
      AnimalOwnershipControlSchema,
      AnimalTransferReasonSchema,
      TransferOtpSchema,
      ...TRANSFER_REQUEST_MODELS.map((m) => m.schema),
      NotificationDeviceSchema,
      NotificationDeviceTokenSchema,
      PushDeliverySchema,
      PushAttemptSchema,
    ];
    expect(FLOW_REQUIREMENTS).toHaveLength(15);
    expect(
      FLOW_REQUIREMENTS.filter((c) => c.management === 'SHARED'),
    ).toHaveLength(4);
    expect(FLOW_REQUIREMENTS.flatMap((c) => c.indexes)).toHaveLength(38);
    for (const schema of schemas) {
      const required = FLOW_REQUIREMENTS.find(
        (c) => c.name === schema.get('collection'),
      )!;
      expect(required).toBeDefined();
      const declared = schema.indexes().map(([key, options]) => ({
        key,
        unique: options.unique ?? false,
        sparse: options.sparse ?? false,
      }));
      expect(
        required.indexes
          .filter((i) => Object.keys(i.key).join(',') !== '_id')
          .map((i) => ({
            key: i.key,
            unique: i.unique ?? false,
            sparse: i.sparse ?? false,
          })),
      ).toEqual(declared);
      expect(Object.isFrozen(required.indexes)).toBe(true);
    }
  });
  it('accepts current declarations under arbitrary index names, without claiming data, transaction or activation evidence', () => {
    const m = completeFlowMetadata();
    m.collections.forEach((c) =>
      c.indexes.forEach((i) => {
        i.name = 'existing_name';
      }),
    );
    expect(assessTransferFlowMongo(m, flowTarget, flowAt)).toMatchObject({
      status: 'SATISFIED',
      transactions: 'NOT_PROBED',
      data: 'NOT_ASSESSED',
      activation: 'DISABLED',
      issues: [],
    });
  });
  it.each(['wrong-rs', 'secondary', 'no-sessions', 'mongos'] as const)(
    'blocks unsupported topology %s',
    (kind) => {
      const m = completeFlowMetadata();
      if (kind === 'wrong-rs') m.hello.setName = 'other';
      if (kind === 'secondary') m.hello.isWritablePrimary = false;
      if (kind === 'no-sessions')
        m.hello.logicalSessionTimeoutMinutes = undefined;
      if (kind === 'mongos') m.hello.msg = 'isdbgrid';
      expect(
        assessTransferFlowMongo(m, flowTarget, flowAt).issues,
      ).toContainEqual({ code: 'TOPOLOGY' });
    },
  );
  it.each([0, 15000, 'invalid'])(
    'flags global client CSOT %s as unreviewed compatibility',
    (value) => {
      const m = completeFlowMetadata();
      m.clientTimeoutMS = value;
      expect(
        assessTransferFlowMongo(m, flowTarget, flowAt).issues,
      ).toContainEqual({ code: 'CLIENT_TIMEOUT' });
    },
  );
  it.each([
    'capped',
    'timeseries',
    'collation',
    'validator',
    'clusteredIndex',
    'encryptedFields',
    'view',
    'duplicate',
  ] as const)('does not call collection %s compatible', (kind) => {
    const m = completeFlowMetadata(),
      c = m.collections[5];
    if (kind === 'view') c.type = 'view';
    else if (kind === 'duplicate') m.collections.push(structuredClone(c));
    else
      c.options = {
        [kind]:
          kind === 'collation'
            ? { locale: 'en' }
            : kind === 'validator'
              ? { required: ['business'] }
              : true,
      };
    expect(
      assessTransferFlowMongo(m, flowTarget, flowAt).issues,
    ).toContainEqual({ code: 'COLLECTION_OPTIONS', collection: c.name });
  });
  it.each([
    'unique',
    'sparse',
    'hidden',
    'partialFilterExpression',
    'collation',
    'expireAfterSeconds',
    'prepareUnique',
    'buildUUID',
    'ready',
  ] as const)('refuses incompatible index option %s', (kind) => {
    const m = completeFlowMetadata(),
      c = m.collections.find((c) => c.name === 'animal_transfers')!,
      i = c.indexes[1];
    i[kind] =
      kind === 'collation'
        ? { locale: 'en' }
        : kind === 'ready'
          ? false
          : kind === 'expireAfterSeconds'
            ? 0
            : true;
    expect(
      assessTransferFlowMongo(m, flowTarget, flowAt).issues.some(
        (issue) =>
          issue.code === 'INDEX_OPTIONS' && issue.collection === c.name,
      ),
    ).toBe(true);
  });
  it('distinguishes a missing index from reserved-name conflict, and does not adopt unexpected uniqueness or TTL', () => {
    const m = completeFlowMetadata(),
      c = m.collections.find((c) => c.name === 'animal_transfers')!;
    c.indexes[1].key = { wrong: 1 };
    c.indexes.push(
      { key: { extra: 1 }, unique: true },
      { key: { garbage: 1 }, expireAfterSeconds: 0 },
    );
    const codes = assessTransferFlowMongo(m, flowTarget, flowAt).issues.map(
      (i) => i.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'INDEX_OPTIONS',
        'TTL_PRESENT',
        'UNREVIEWED_UNIQUE_INDEX',
      ]),
    );
  });
  it('tolerates unrelated nonunique indexes but checks native _id metadata', () => {
    const m = completeFlowMetadata(),
      c = m.collections[4];
    c.indexes.push({ key: { extra: 1 } });
    expect(assessTransferFlowMongo(m, flowTarget, flowAt).status).toBe(
      'SATISFIED',
    );
    c.indexes.shift();
    expect(
      assessTransferFlowMongo(m, flowTarget, flowAt).issues,
    ).toContainEqual({
      code: 'INDEX_MISSING',
      collection: c.name,
      indexId: `${c.name}:IDENTITY`,
    });
  });
});
