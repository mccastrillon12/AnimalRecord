import { MongoTransferAcceptancePreparation } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-preparation';
import { TransferAcceptancePreparation } from '../../../src/context/animal-transfer/application/transfer-acceptance-preparation';
import { TransferAcceptancePreparationModule } from '../../../src/app/animal-transfer/transfer-acceptance-preparation.module';
import { AnimalTransferModule } from '../../../src/app/animal-transfer/animal-transfer.module';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { MedicalDocumentStatus } from '../../../src/context/medical-document/domain/medical-document';
import { acceptanceFixture } from '../fixtures/transfer-acceptance-preparation.fixture';

function fixture(count = 2) {
  const f = acceptanceFixture(count),
    calls: Array<{
      role: string;
      method: string;
      filter?: Record<string, unknown>;
      projection?: unknown;
      session?: unknown;
      limit?: number;
      collation?: unknown;
    }> = [];
  const flags = {
    missing: false,
    standalone: false,
    failRead: false,
    pending: false,
    corruptWriters: false,
    endFailure: false,
  };
  const session = {
    withTransaction: jest.fn(
      (work: () => Promise<unknown>, options: unknown) => {
        void options;
        return work();
      },
    ),
    endSession: jest.fn(() =>
      flags.endFailure
        ? Promise.reject(new Error('private close detail'))
        : Promise.resolve(),
    ),
  };
  const connection = {
    readyState: 1,
    startSession: jest.fn().mockResolvedValue(session),
    db: {
      admin: () => ({
        command: () =>
          Promise.resolve(
            flags.standalone
              ? {}
              : {
                  setName: 'synthetic',
                  isWritablePrimary: true,
                  logicalSessionTimeoutMinutes: 30,
                },
          ),
      }),
      listCollections: () => ({
        toArray: () =>
          Promise.resolve(
            flags.missing
              ? []
              : [
                  'animal_transfers',
                  'animal_transfer_items',
                  'animal_transfer_active_items',
                  'animals',
                  'animal_ownership_controls',
                  'animal_ownership_periods',
                  'medical_documents',
                ].map((name) => ({ name, type: 'collection', options: {} })),
          ),
      }),
    },
  };
  function model(role: string) {
    function query(method: string, filter: Record<string, unknown>) {
      const call: (typeof calls)[number] = { role, method, filter };
      const q = {
        select: (projection: unknown) => {
          call.projection = projection;
          return q;
        },
        session: (value: unknown) => {
          call.session = value;
          return q;
        },
        collation: (value: unknown) => {
          call.collation = value;
          return q;
        },
        sort: () => q,
        limit: (n: number) => {
          call.limit = n;
          return q;
        },
        lean: () => q,
        exec: () => {
          calls.push(call);
          if (flags.failRead)
            return Promise.reject(new Error('private document / token'));
          const data =
            role === 'requests'
              ? f.snapshot.request
              : role === 'items'
                ? f.snapshot.items
                    .filter(
                      (i) =>
                        !(filter.animalId as { $gt?: string } | undefined)
                          ?.$gt ||
                        i.animalId > (filter.animalId as { $gt: string }).$gt,
                    )
                    .slice(0, call.limit)
                : role === 'claims'
                  ? f.snapshot.claims
                  : role === 'animals'
                    ? f.snapshot.animals
                    : role === 'periods'
                      ? f.snapshot.periods
                      : role === 'medical'
                        ? flags.pending
                          ? { _id: 'private-document-id' }
                          : null
                        : f.snapshot.controls.map((c) => ({
                            ...c,
                            transferLock: c.lockPresent
                              ? { transferId: f.input.transferId }
                              : undefined,
                            activeWrites: flags.corruptWriters
                              ? 'invalid'
                              : c.writersPresent
                                ? [{ token: 'private-writer-token' }]
                                : [],
                          }));
          return Promise.resolve(structuredClone(data));
        },
      };
      return q;
    }
    return {
      db: connection,
      findById: (id: string) => query('findById', { _id: id }),
      find: (filter: Record<string, unknown>) => query('find', filter),
      findOne: (filter: Record<string, unknown>) => query('findOne', filter),
    };
  }
  const models = [
    'requests',
    'items',
    'claims',
    'animals',
    'controls',
    'periods',
    'medical',
  ].map(model);
  const store = new MongoTransferAcceptancePreparation(
    ...(models as unknown as ConstructorParameters<
      typeof MongoTransferAcceptancePreparation
    >),
  );
  return {
    ...f,
    store,
    service: new TransferAcceptancePreparation(store),
    calls,
    models,
    flags,
    connection,
    session,
  };
}
describe('Internal acceptance snapshot preparation, simulated driver only', () => {
  it('reads seven sources in one bounded snapshot session, projects candidate metadata and writes nothing', async () => {
    const f = fixture();
    const before = structuredClone(f.snapshot),
      result = await f.service.prepare(f.input);
    expect(result.reservation).toBe('NOT_ACQUIRED');
    expect(result.businessCommit).toBe('NOT_AUTHORIZED');
    expect(f.calls.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'animals',
      'controls',
      'periods',
      'medical',
    ]);
    expect(f.calls.every((c) => c.session === f.session)).toBe(true);
    expect(f.session.withTransaction.mock.calls[0][1]).toMatchObject({
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
      timeoutMS: 15000,
      maxCommitTimeMS: 5000,
    });
    expect(f.snapshot).toEqual(before);
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(f.calls.find((c) => c.role === 'requests')?.projection),
    ).not.toMatch(/bodyHash|authorization|Name/);
    expect(f.calls.find((c) => c.role === 'medical')?.projection).toEqual({
      _id: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|writer|document-id|proof|Name/,
    );
  });
  it('pages the complete stored request beyond 100 items without inventing an animal count rule', async () => {
    const f = fixture(101);
    const result = await f.service.prepare(f.input);
    expect(result.rejectedItemIds).toHaveLength(100);
    expect(result.selected).toHaveLength(1);
    const pages = f.calls.filter((c) => c.role === 'items');
    expect(pages).toHaveLength(2);
    expect(pages[0].limit).toBe(100);
    expect(pages[1].filter?.animalId).toEqual({ $gt: f.id(199) });
    expect(
      pages.every((c) => JSON.stringify(c.collation) === '{"locale":"simple"}'),
    ).toBe(true);
  });
  it.each(['missing', 'standalone', 'binding'] as const)(
    'fails preflight %s before opening a transaction or reading business data',
    async (kind) => {
      const f = fixture();
      if (kind === 'binding') f.models[3].db = { ...f.connection };
      else f.flags[kind] = true;
      await expect(f.service.prepare(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.connection.startSession).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
    },
  );
  it('authorizes the recipient before loading associated animal/medical sources', async () => {
    const f = fixture();
    await expect(
      f.service.prepare({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.calls.map((c) => c.role)).toEqual(['requests']);
  });
  it('uses the existing pending-medical allowlist without owner filtering or cancellation/normalization writes', async () => {
    const f = fixture();
    f.flags.pending = true;
    await expect(f.service.prepare(f.input)).rejects.toThrow(
      'owner must finish or discard',
    );
    const query = f.calls.find((c) => c.role === 'medical')!;
    expect(query.filter).toEqual({
      animalIds: f.id(100),
      status: {
        $nin: [
          MedicalDocumentStatus.Accepted,
          MedicalDocumentStatus.Rejected,
          MedicalDocumentStatus.Failed,
        ],
      },
    });
    expect(
      f.calls.every((c) => ['find', 'findById', 'findOne'].includes(c.method)),
    ).toBe(true);
  });
  it('does not join an existing same-transfer reservation without a durable capture binding', async () => {
    const f = fixture();
    f.snapshot.controls[0].lockPresent = true;
    await expect(f.service.prepare(f.input)).rejects.toThrow(
      'busy or reserved',
    );
    expect(f.snapshot.controls[0].lockPresent).toBe(true);
  });
  it('captures selection before awaiting connection/session reads', async () => {
    const f = fixture(),
      raw = { ...f.input, acceptedAnimalIds: [...f.input.acceptedAnimalIds] };
    const result = f.service.prepare(raw);
    raw.acceptedAnimalIds.push(f.id(900));
    raw.operationId = f.id(900);
    expect((await result).selected.map((i) => i.animalId)).toEqual([f.id(100)]);
  });
  it('leaves the old observation explicitly unauthorized after a subsequent source change', async () => {
    const f = fixture();
    const previous = await f.service.prepare(f.input);
    f.snapshot.controls[0].writersPresent = true;
    await expect(f.service.prepare(f.input)).rejects.toThrow('busy');
    expect(previous.businessCommit).toBe('NOT_AUTHORIZED');
    expect(previous.reservation).toBe('NOT_ACQUIRED');
  });
  it.each(['failRead', 'endFailure', 'corruptWriters'] as const)(
    'denies %s without exposing private storage metadata',
    async (kind) => {
      const f = fixture();
      f.flags[kind] = true;
      const error: unknown = await f.service
        .prepare(f.input)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toMatch(/private|token|document-id/);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    },
  );
  it('remains outside the app graph and exports no capture/lock providers', () => {
    const imports: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AnimalTransferModule,
    ) as unknown[];
    expect(imports).not.toContain(TransferAcceptancePreparationModule);
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        TransferAcceptancePreparationModule,
      ),
    ).toEqual([TransferAcceptancePreparation]);
  });
  it('preserves the primary recipient denial if closing the read session also fails', async () => {
    const f = fixture();
    f.flags.endFailure = true;
    await expect(
      f.service.prepare({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });
});
