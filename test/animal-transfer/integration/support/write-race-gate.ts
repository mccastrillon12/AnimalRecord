export type WriteRacePoint = 'ACQUIRE' | 'RECOVER' | 'PERMIT';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function bounded<T>(
  promise: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out at integration barrier: ${label}`)),
          8000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Delay queries only; every result and transaction still comes from Mongo. */
export class WriteRaceGate {
  private pause?: {
    point: WriteRacePoint;
    entered: ReturnType<typeof deferred>;
    resume: ReturnType<typeof deferred>;
  };
  private releases: Array<() => void> = [];
  readonly counts = { ACQUIRE: 0, RECOVER: 0, PERMIT: 0 };

  arm(point: WriteRacePoint) {
    if (this.pause) throw new Error('A race barrier is already armed');
    const entered = deferred(),
      resume = deferred();
    this.pause = { point, entered, resume };
    this.releases.push(resume.resolve);
    return {
      entered: () => bounded(entered.promise, `${point}:entered`),
      release: resume.resolve,
    };
  }

  async beforeWrite(update: unknown): Promise<void> {
    const set = (update as { $set?: Record<string, unknown> } | null)?.$set;
    const point: WriteRacePoint | undefined =
      set?.['claims.$.state'] === 'ACQUIRED'
        ? 'ACQUIRE'
        : set?.lifecycle === 'RECOVERED_BEFORE_CALLBACK'
          ? 'RECOVER'
          : set?.callback === 'MAY_RUN'
            ? 'PERMIT'
            : undefined;
    if (!point) return;
    this.counts[point]++;
    const pause = this.pause;
    if (!pause || pause.point !== point) return;
    this.pause = undefined; // Retries must proceed without pausing a second time.
    pause.entered.resolve();
    await bounded(pause.resume.promise, `${point}:resume`);
  }

  releaseAll(): void {
    this.pause = undefined;
    for (const release of this.releases) release();
    this.releases = [];
  }
}
