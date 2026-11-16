import { Logger } from '@nestjs/common';
import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  createWriteJournalFixture,
  withJournalAcquisition,
} from '../fixtures/animal-write-journal.fixture';
import { AnimalWriteInstance } from '../../../src/context/animal-transfer/application/animal-write-instance';
import { validate as isUuid } from 'uuid';

describe('AnimalWriteCoordinator', () => {
  const setup = () => {
    const journal = createWriteJournalFixture();
    const access = { findWritableAnimal: jest.fn().mockResolvedValue({}) };
    const ownership = {
      findControl: jest
        .fn()
        .mockResolvedValue({ ownerId: 'owner', ownershipVersion: 2 }),
      beginWrite: jest
        .fn<
          Promise<boolean>,
          [Parameters<AnimalOwnershipRepository['beginWrite']>[0]]
        >()
        .mockResolvedValue(true),
      endWrite: jest.fn().mockResolvedValue(undefined),
      recordUploadWindow: jest.fn().mockResolvedValue(true),
    };
    const coordinator = new AnimalWriteCoordinator(
      access as unknown as AnimalAccessPolicy,
      withJournalAcquisition(
        ownership,
        journal,
      ) as unknown as AnimalOwnershipRepository,
      journal.journal,
      journal.instance,
    );
    return { coordinator, ownership, access, ...journal };
  };

  it('holds a persistent claim until every asynchronous write and cleanup finishes', async () => {
    const { coordinator, ownership } = setup();
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = coordinator.run(['animal'], 'owner', async () => {
      entered();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return 'saved';
    });
    await started;
    expect(ownership.beginWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        animalId: 'animal',
        expectedOwnershipVersion: 2,
      }),
    );
    expect(ownership.endWrite).not.toHaveBeenCalled();
    finish();
    await expect(pending).resolves.toBe('saved');
    const claim = ownership.beginWrite.mock.calls[0][0];
    expect(ownership.endWrite).toHaveBeenCalledWith('animal', claim.token);
  });

  it('deduplicates/sorts claims and releases previous claims if a later animal is locked', async () => {
    const { coordinator, ownership } = setup();
    ownership.beginWrite
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const operation = jest.fn();
    await expect(
      coordinator.run(['b', 'a', 'a'], 'owner', operation),
    ).rejects.toThrow('temporarily locked');
    expect(
      ownership.beginWrite.mock.calls.map(([input]) => input.animalId),
    ).toEqual(['a', 'b']);
    expect(operation).not.toHaveBeenCalled();
    expect(ownership.endWrite).toHaveBeenCalledTimes(1);
    expect(ownership.endWrite).toHaveBeenCalledWith('a', expect.any(String));
  });

  it('rejects ownership changes before registering any write', async () => {
    const { coordinator, ownership } = setup();
    ownership.findControl.mockResolvedValue({
      ownerId: 'new-owner',
      ownershipVersion: 3,
    });
    const operation = jest.fn();
    await expect(coordinator.run(['a'], 'owner', operation)).rejects.toThrow(
      'temporarily locked',
    );
    expect(ownership.beginWrite).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('releases claims on callback failure without hiding the original error', async () => {
    const { coordinator, ownership } = setup();
    const failure = new Error('S3 rollback complete');
    await expect(
      coordinator.run(['a'], 'owner', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(ownership.endWrite).toHaveBeenCalledTimes(1);
  });

  it('preserves a committed success on release failure, leaving recovery explicit', async () => {
    const { coordinator, ownership } = setup();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    ownership.endWrite.mockRejectedValue(new Error('Mongo unavailable'));
    try {
      await expect(
        coordinator.run(['a'], 'owner', () => Promise.resolve('saved')),
      ).resolves.toBe('saved');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Write claim recovery required'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not return a signed URL unless its upload window was persisted', async () => {
    const { coordinator, ownership } = setup();
    ownership.recordUploadWindow.mockResolvedValue(false);
    await expect(
      coordinator.run(
        ['a'],
        'owner',
        () => Promise.resolve({ uploadUrl: 'signed' }),
        { issuesUploadUrl: true },
      ),
    ).rejects.toThrow('upload window could not be recorded');
    expect(ownership.endWrite).toHaveBeenCalledTimes(1);
  });

  it('records five minutes after signing (a conservative bound) before releasing', async () => {
    const { coordinator, ownership } = setup();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
    try {
      await coordinator.run(
        ['a'],
        'owner',
        () => {
          jest.advanceTimersByTime(1000);
          return Promise.resolve('signed');
        },
        { issuesUploadUrl: true },
      );
      expect(ownership.recordUploadWindow).toHaveBeenCalledWith(
        'a',
        expect.any(String),
        '2026-10-25T12:05:01.000Z',
      );
      expect(
        ownership.recordUploadWindow.mock.invocationCallOrder[0],
      ).toBeLessThan(ownership.endWrite.mock.invocationCallOrder[0]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('coordinates two application instances without cross-releasing their claims', async () => {
    const ctx = setup();
    const { coordinator, ownership, access, journal, instance } = ctx;
    const active = new Set<string>();
    let locked = false;
    ownership.beginWrite.mockImplementation((input: { token: string }) => {
      if (locked) return Promise.resolve(false);
      active.add(input.token);
      return Promise.resolve(true);
    });
    ownership.endWrite.mockImplementation(
      (_animalId: string, token: string) => {
        active.delete(token);
        return Promise.resolve();
      },
    );
    const second = new AnimalWriteCoordinator(
      access as unknown as AnimalAccessPolicy,
      withJournalAcquisition(
        ownership,
        ctx,
      ) as unknown as AnimalOwnershipRepository,
      journal,
      { ...instance, id: '123e4567-e89b-42d3-a456-426614174098' },
    );
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = coordinator.run(['a'], 'owner', async () => {
      entered();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await started;
    await second.run(['a'], 'owner', () => Promise.resolve());
    expect(active.size).toBe(1); // Second instance cannot release the first token.
    const tryTransfer = () => {
      if (active.size) return false;
      locked = true;
      return true;
    };
    expect(tryTransfer()).toBe(false);
    finish();
    await pending;
    expect(tryTransfer()).toBe(true);
    await expect(
      second.run(['a'], 'owner', () => Promise.resolve()),
    ).rejects.toThrow('temporarily locked');
  });

  it('rejects an unscoped mutation without executing its callback', async () => {
    const { coordinator } = setup();
    const operation = jest.fn();
    await expect(coordinator.run([], 'owner', operation)).rejects.toThrow(
      'At least one animal',
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not mutate or guess cleanup when claim acknowledgement is uncertain', async () => {
    const { coordinator, ownership } = setup();
    const failure = new Error('Majority acknowledgement timed out');
    ownership.beginWrite.mockRejectedValue(failure);
    const operation = jest.fn();
    await expect(coordinator.run(['a'], 'owner', operation)).rejects.toBe(
      failure,
    );
    expect(operation).not.toHaveBeenCalled();
    expect(ownership.endWrite).not.toHaveBeenCalled();
  });

  describe('durable operation journal', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it('persists ordered scope/identity/intents before claims and permission before callback, without retaining payloads', async () => {
      const ctx = setup();
      const operation = jest
        .fn()
        .mockResolvedValue({ clinical: 'not stored in journal' });
      await ctx.coordinator.run(['b', 'a', 'a'], 'owner', operation, {
        kind: 'MEDICAL_REVIEW_ACCEPT',
      });
      const entry = [...ctx.entries.values()][0];
      expect(entry).toMatchObject({
        kind: 'MEDICAL_REVIEW_ACCEPT',
        actorId: 'owner',
        instanceId: ctx.instance.id,
        instanceStartedAt: ctx.instance.startedAt,
        callback: 'RETURNED',
        coordinatorOutcome: 'RETURNED',
        lifecycle: 'LOCALLY_FINISHED',
      });
      expect(
        entry.claims.map((claim) => [
          claim.animalId,
          claim.state,
          claim.ownershipVersion,
        ]),
      ).toEqual([
        ['a', 'RELEASED', 2],
        ['b', 'RELEASED', 2],
      ]);
      expect(ctx.journal.create.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.ownership.beginWrite.mock.invocationCallOrder[0],
      );
      expect(ctx.journal.claim.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.ownership.beginWrite.mock.invocationCallOrder[0],
      );
      expect(
        ctx.journal.permitCallback.mock.invocationCallOrder[0],
      ).toBeLessThan(operation.mock.invocationCallOrder[0]);
      expect(ctx.ownership.beginWrite.mock.calls[0][0].journal).toEqual({
        operationId: entry.id,
        instanceId: ctx.instance.id,
      });
      expect(JSON.stringify(entry)).not.toContain('clinical');
    });

    it.each([false, true])(
      'does not acquire claims or invoke a callback on creation failure (persisted=%s)',
      async (persisted) => {
        const ctx = setup();
        const create = ctx.journal.create.getMockImplementation()!;
        const error = new Error('Journal write uncertain');
        ctx.journal.create.mockImplementationOnce((input) => {
          if (persisted) void create(input);
          return Promise.reject(error);
        });
        const callback = jest.fn();
        await expect(
          ctx.coordinator.run(['a'], 'owner', callback),
        ).rejects.toBe(error);
        expect(ctx.ownership.beginWrite).not.toHaveBeenCalled();
        expect(ctx.ownership.endWrite).not.toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
        expect(ctx.entries.size).toBe(persisted ? 1 : 0);
      },
    );

    it('keeps permission errors ahead of journal preparation and never journals an unauthorized scope', async () => {
      const ctx = setup();
      const denial = new Error('Forbidden');
      ctx.access.findWritableAnimal.mockRejectedValue(denial);
      ctx.journal.create.mockRejectedValue(new Error('Mongo unavailable'));
      await expect(ctx.coordinator.run(['a'], 'owner', jest.fn())).rejects.toBe(
        denial,
      );
      expect(ctx.journal.create.mock.calls).toHaveLength(0);
      expect(ctx.ownership.beginWrite).not.toHaveBeenCalled();
    });

    it('does not begin a claim when intent acknowledgement fails, even if INTENT was persisted', async () => {
      const ctx = setup();
      const claim = ctx.journal.claim.getMockImplementation()!;
      ctx.journal.claim.mockImplementationOnce((...args) => {
        void claim(...args);
        return Promise.reject(new Error('Intent acknowledgement lost'));
      });
      const callback = jest.fn();
      await expect(
        ctx.coordinator.run(['a'], 'owner', callback),
      ).rejects.toThrow('Intent acknowledgement lost');
      expect(ctx.ownership.beginWrite).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect([...ctx.entries.values()][0]).toMatchObject({
        lifecycle: 'OPEN',
        callback: 'NOT_INVOKED',
        claims: [{ state: 'INTENT' }],
      });
    });

    it('releases a certainly acquired claim if recording ACQUIRED fails, without starting callback', async () => {
      const ctx = setup();
      const claim = ctx.journal.claim.getMockImplementation()!;
      ctx.journal.claim.mockImplementation((...args) =>
        args[2] === 'ACQUIRED'
          ? Promise.reject(new Error('Acquired journal failed'))
          : claim(...args),
      );
      const callback = jest.fn();
      await expect(
        ctx.coordinator.run(['a'], 'owner', callback),
      ).rejects.toThrow('Acquired journal failed');
      expect(callback).not.toHaveBeenCalled();
      expect(ctx.ownership.endWrite).toHaveBeenCalledTimes(1);
      expect([...ctx.entries.values()][0]).toMatchObject({
        lifecycle: 'LOCALLY_FINISHED',
        callback: 'NOT_INVOKED',
        claims: [{ state: 'RELEASED' }],
      });
    });

    it('records NOT_INVOKED and releases known claims if callback permission acknowledgement was lost', async () => {
      const ctx = setup();
      const permit = ctx.journal.permitCallback.getMockImplementation()!;
      ctx.journal.permitCallback.mockImplementationOnce((...args) => {
        void permit(...args);
        return Promise.reject(new Error('Permission acknowledgement lost'));
      });
      const callback = jest.fn();
      await expect(
        ctx.coordinator.run(['a'], 'owner', callback),
      ).rejects.toThrow('Permission acknowledgement lost');
      expect(callback).not.toHaveBeenCalled();
      expect([...ctx.entries.values()][0]).toMatchObject({
        lifecycle: 'LOCALLY_FINISHED',
        callback: 'NOT_INVOKED',
      });
    });

    it('retains an unknown acquisition on the second animal while releasing only the first known claim', async () => {
      const ctx = setup();
      const error = new Error('Acquire acknowledgement lost');
      ctx.ownership.beginWrite
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(error);
      const callback = jest.fn();
      await expect(
        ctx.coordinator.run(['b', 'a'], 'owner', callback),
      ).rejects.toBe(error);
      expect(
        ctx.ownership.endWrite.mock.calls.map((call: unknown[]) => call[0]),
      ).toEqual(['a']);
      expect(callback).not.toHaveBeenCalled();
      expect([...ctx.entries.values()][0]).toMatchObject({
        lifecycle: 'OPEN',
        callback: 'NOT_INVOKED',
        coordinatorOutcome: 'THREW',
        claims: [
          { animalId: 'a', state: 'RELEASED' },
          { animalId: 'b', state: 'ACQUIRE_UNKNOWN' },
        ],
      });
    });

    it('records a thrown callback without claiming rollback or retaining its error, and preserves the original error', async () => {
      const ctx = setup();
      const error = new Error('private business payload');
      await expect(
        ctx.coordinator.run(['a'], 'owner', () => Promise.reject(error)),
      ).rejects.toBe(error);
      const entry = [...ctx.entries.values()][0];
      expect(entry).toMatchObject({
        callback: 'THREW',
        coordinatorOutcome: 'THREW',
        lifecycle: 'LOCALLY_FINISHED',
      });
      expect(JSON.stringify(entry)).not.toContain(error.message);
      expect(entry).not.toHaveProperty('rolledBack');
    });

    it.each(['settleCallback', 'finish'] as const)(
      'preserves a business success despite a %s journal failure',
      async (method) => {
        const ctx = setup();
        ctx.journal[method].mockRejectedValue(new Error('Journal unavailable'));
        await expect(
          ctx.coordinator.run(['a'], 'owner', () => Promise.resolve('saved')),
        ).resolves.toBe('saved');
        expect(ctx.ownership.endWrite).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();
        expect([...ctx.entries.values()][0].lifecycle).toBe('OPEN');
      },
    );

    it('does not turn a release error into either a retry or a false closed journal', async () => {
      const ctx = setup();
      ctx.ownership.endWrite.mockRejectedValue(
        new Error('Release acknowledgement lost'),
      );
      await expect(
        ctx.coordinator.run(['a'], 'owner', () => Promise.resolve('saved')),
      ).resolves.toBe('saved');
      expect(ctx.ownership.endWrite).toHaveBeenCalledTimes(1);
      expect([...ctx.entries.values()][0]).toMatchObject({
        lifecycle: 'OPEN',
        callback: 'RETURNED',
        claims: [{ state: 'RELEASE_UNKNOWN' }],
      });
    });

    it('distinguishes callback return from a coordinator error recording the upload window, without storing the URL', async () => {
      const ctx = setup();
      ctx.ownership.recordUploadWindow.mockResolvedValue(false);
      await expect(
        ctx.coordinator.run(
          ['a'],
          'owner',
          () => Promise.resolve({ uploadUrl: 'private-signed-url' }),
          { issuesUploadUrl: true, kind: 'PROFILE_UPLOAD_URL' },
        ),
      ).rejects.toThrow('upload window');
      const entry = [...ctx.entries.values()][0];
      expect(entry).toMatchObject({
        callback: 'RETURNED',
        coordinatorOutcome: 'THREW',
        issuesUploadUrl: true,
        lifecycle: 'LOCALLY_FINISHED',
      });
      expect(JSON.stringify(entry)).not.toContain('private-signed-url');
    });

    it('uses one random UUID boot identity per process without including host/credential data', () => {
      const first = new AnimalWriteInstance(),
        second = new AnimalWriteInstance();
      expect(first.id).toBe(second.id);
      expect(isUuid(first.id)).toBe(true);
      expect(first.startedAt).toBe(second.startedAt);
      expect(Object.keys(first).sort()).toEqual(['id', 'startedAt']);
    });
  });
});
