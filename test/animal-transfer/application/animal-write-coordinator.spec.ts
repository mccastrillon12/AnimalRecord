import { Logger } from '@nestjs/common';
import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';

describe('AnimalWriteCoordinator', () => {
  const setup = () => {
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
      ownership as unknown as AnimalOwnershipRepository,
    );
    return { coordinator, ownership, access };
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
    const { coordinator, ownership, access } = setup();
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
      ownership as unknown as AnimalOwnershipRepository,
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
});
