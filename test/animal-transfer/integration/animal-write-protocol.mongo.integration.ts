import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { readLocalMongoTestSettings } from './support/local-mongo-test-safety';
import { WriteMongoFixture } from './support/write-mongo-fixture';

// Separate Jest config and filename keep this suite out of npm test.
describe('Write protocol with an explicitly selected disposable Mongo replica set', () => {
  const fixture = new WriteMongoFixture();
  beforeAll(async () => {
    await fixture.open(readLocalMongoTestSettings(process.env));
  });
  afterEach(async () => {
    await fixture.drain();
  });
  afterAll(async () => {
    await fixture.close();
  });

  it('uses real unique indexes without TTL and refuses reuse of journal/control identities', async () => {
    const s = await fixture.seed(1);
    const journalIndexes = await fixture.a.journals.collection.indexes();
    const controlIndexes = await fixture.a.controls.collection.indexes();
    expect(
      journalIndexes.some((index) => index.unique && index.key.id === 1),
    ).toBe(true);
    expect(
      controlIndexes.some((index) => index.unique && index.key.animalId === 1),
    ).toBe(true);
    expect(
      [...journalIndexes, ...controlIndexes].some(
        (index) => index.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
    const existing = (await fixture.a.journal.find(s.handle.id))!;
    await expect(
      fixture.a.journal.create({
        ...existing,
        claims: existing.claims.map((claim) => ({
          ...claim,
          state: 'NOT_ATTEMPTED',
        })),
      }),
    ).rejects.toThrow('ID has already been used');
    await expect(
      fixture.a.controls.create({
        animalId: s.animalIds[0],
        ownerId: s.actorId,
        ownershipVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('sends the control claim and journal authorization in one snapshot transaction with majority commit', async () => {
    const s = await fixture.seed(1),
      start = fixture.commands.length;
    await expect(s.acquire(fixture.a)).resolves.toBe(true);
    const commands = fixture.commands.slice(start);
    const control = commands.find(
      (event) =>
        event.collection === 'animal_ownership_controls' && event.transaction,
    );
    const journal = commands.find(
      (event) =>
        event.collection === 'animal_write_journals' && event.transaction,
    );
    expect(control?.transaction).toBeDefined();
    expect(journal?.transaction).toBe(control?.transaction);
    expect(
      commands.some(
        (event) => event.transaction === control?.transaction && event.snapshot,
      ),
    ).toBe(true);
    expect(
      commands.some(
        (event) =>
          event.transaction === control?.transaction &&
          event.command === 'commitTransaction' &&
          event.majority,
      ),
    ).toBe(true);
    expect((await s.control())?.activeWrites).toHaveLength(1);
    expect((await fixture.b.journal.find(s.handle.id))?.claims[0].state).toBe(
      'ACQUIRED',
    );
  });

  it('aborts the tentative control insertion if journal authorization does not match', async () => {
    const s = await fixture.seed(1);
    await fixture.b.journal.settleCallback(
      s.handle,
      'NOT_INVOKED',
      new Date().toISOString(),
    );
    await expect(s.acquire(fixture.a)).rejects.toBeInstanceOf(ConflictError);
    expect((await s.control())?.activeWrites).toEqual([]);
    expect((await fixture.b.journal.find(s.handle.id))?.claims[0].state).toBe(
      'INTENT',
    );
  });

  it('fences an acquisition already in flight when recovery commits first', async () => {
    const s = await fixture.seed(1),
      pause = fixture.a.gate.arm('ACQUIRE');
    const pending = fixture.observe(s.acquire(fixture.a));
    await pause.entered(); // The control write is real but still uncommitted.
    const recovered = await fixture.b.recovery.recoverBeforeCallback(s.request);
    expect(recovered.recovery?.claims[0].tokenRemoved).toBe(false);
    pause.release();
    const result = await pending;
    expect('error' in result && result.error).toBeInstanceOf(ConflictError);
    expect((await s.control())?.activeWrites).toEqual([]);
    expect((await fixture.a.journal.find(s.handle.id))?.lifecycle).toBe(
      'RECOVERED_BEFORE_CALLBACK',
    );
  });

  it('retries a stale recovery snapshot after acquisition wins and removes the newly committed token', async () => {
    const s = await fixture.seed(1),
      before = fixture.b.gate.counts.RECOVER;
    const pause = fixture.b.gate.arm('RECOVER');
    const pending = fixture.observe(
      fixture.b.recovery.recoverBeforeCallback(s.request),
    );
    await pause.entered(); // A real snapshot observed no token before acquisition.
    await expect(s.acquire(fixture.a)).resolves.toBe(true);
    pause.release();
    const result = await pending;
    expect('value' in result && result.value.recovery?.claims[0]).toMatchObject(
      { previousState: 'ACQUIRED', tokenRemoved: true },
    );
    expect(fixture.b.gate.counts.RECOVER - before).toBeGreaterThan(1);
    expect((await s.control())?.activeWrites).toEqual([]);
  });

  it('aborts tentative removals when MAY_RUN wins against recovery', async () => {
    const s = await fixture.seed();
    for (let index = 0; index < s.animalIds.length; index++)
      await s.acquire(fixture.a, index);
    const pause = fixture.b.gate.arm('RECOVER');
    const pending = fixture.observe(
      fixture.b.recovery.recoverBeforeCallback(s.request),
    );
    await pause.entered(); // Removals hold Mongo write locks, still uncommitted.
    await fixture.a.journal.permitCallback(s.handle, new Date().toISOString());
    pause.release();
    const result = await pending;
    expect('error' in result && result.error).toBeInstanceOf(ConflictError);
    expect((await fixture.a.journal.find(s.handle.id))?.callback).toBe(
      'MAY_RUN',
    );
    for (let index = 0; index < s.animalIds.length; index++)
      expect((await s.control(index))?.activeWrites).toHaveLength(1);
  });

  it('denies an in-flight MAY_RUN authorization after recovery wins', async () => {
    const s = await fixture.seed(1);
    await s.acquire(fixture.a);
    const pause = fixture.a.gate.arm('PERMIT');
    const pending = fixture.observe(
      fixture.a.journal.permitCallback(s.handle, new Date().toISOString()),
    );
    await pause.entered();
    await fixture.b.recovery.recoverBeforeCallback(s.request);
    pause.release();
    const result = await pending;
    expect('error' in result && result.error).toBeInstanceOf(ConflictError);
    expect((await s.control())?.activeWrites).toEqual([]);
  });

  it('rolls back all removals if a second animal has a colliding legacy token', async () => {
    const s = await fixture.seed();
    await s.acquire(fixture.a);
    await fixture.a.controls
      .updateOne(
        { animalId: s.animalIds[1] },
        {
          $push: {
            activeWrites: {
              token: s.handle.id,
              startedAt: new Date().toISOString(),
            },
          },
        },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    await expect(
      fixture.b.recovery.recoverBeforeCallback(s.request),
    ).rejects.toBeInstanceOf(ConflictError);
    for (let index = 0; index < s.animalIds.length; index++)
      expect((await s.control(index))?.activeWrites).toHaveLength(1);
    const journal = await fixture.a.journal.find(s.handle.id);
    expect(journal?.lifecycle).toBe('OPEN');
    expect(journal?.recovery).toBeUndefined();
  });

  it('recovers after a real acquisition commit whose success was hidden from its caller', async () => {
    const s = await fixture.seed(1);
    fixture.loseNextCommitReply(fixture.a);
    await expect(s.acquire(fixture.a)).rejects.toThrow(
      'Injected application commit reply loss',
    );
    expect((await s.control())?.activeWrites).toHaveLength(1);
    expect((await fixture.b.journal.find(s.handle.id))?.claims[0].state).toBe(
      'ACQUIRED',
    );
    await fixture.a.journal.settleCallback(
      s.handle,
      'NOT_INVOKED',
      new Date().toISOString(),
    );
    await fixture.b.recovery.recoverBeforeCallback(s.request);
    expect((await s.control())?.activeWrites).toEqual([]);
  });

  it('repeats identical recovery after a real commit with hidden reply without touching a later reservation', async () => {
    const s = await fixture.seed(1);
    await s.acquire(fixture.a);
    fixture.loseNextCommitReply(fixture.b);
    await expect(
      fixture.b.recovery.recoverBeforeCallback(s.request),
    ).rejects.toThrow('Injected application commit reply loss');
    const lock = {
      animalId: s.animalIds[0],
      ownerId: s.actorId,
      expectedOwnershipVersion: 1,
      transferId: 'later-test-reservation',
      lockedAt: new Date().toISOString(),
    };
    await expect(fixture.a.ownership.acquireTransferLock(lock)).resolves.toBe(
      true,
    );
    const recovered = await fixture.b.recovery.recoverBeforeCallback(s.request);
    expect(recovered.recovery?.requestId).toBe(s.request.requestId);
    expect((await s.control())?.transferLock?.transferId).toBe(lock.transferId);
    await expect(
      fixture.b.recovery.recoverBeforeCallback({
        ...s.request,
        evidenceRef: 'another:incident',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await s.control())?.transferLock?.transferId).toBe(lock.transferId);
  });

  it('excludes NOT_INVOKED with prior permission and journals without the new protocol', async () => {
    const permitted = await fixture.seed(1);
    await permitted.acquire(fixture.a);
    await fixture.a.journal.permitCallback(
      permitted.handle,
      new Date().toISOString(),
    );
    await fixture.a.journal.settleCallback(
      permitted.handle,
      'NOT_INVOKED',
      new Date().toISOString(),
    );
    await expect(
      fixture.b.recovery.recoverBeforeCallback(permitted.request),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await permitted.control())?.activeWrites).toHaveLength(1);
    const legacy = await fixture.seed(1);
    await fixture.a.journals
      .updateOne(
        { id: legacy.handle.id },
        { $unset: { protocol: 1 } },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    await expect(
      fixture.b.recovery.recoverBeforeCallback(legacy.request),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(legacy.acquire(fixture.a)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await legacy.control())?.activeWrites).toEqual([]);
  });
});
