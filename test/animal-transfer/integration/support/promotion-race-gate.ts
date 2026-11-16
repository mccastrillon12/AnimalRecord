import { bounded, deferred } from './write-race-gate';

export type PromotionRacePoint =
  | 'JOURNAL_FENCE'
  | 'CALLBACK_SETTLE'
  | 'CONTROL_FENCE'
  | 'UPLOAD_FENCE'
  | 'UPLOAD_SEAL'
  | 'GATE_WRITE';

/** Pauses queries before dispatch; never supplies fake database results. */
export class PromotionRaceGate {
  private pause?: {
    point: PromotionRacePoint;
    entered: ReturnType<typeof deferred>;
    resume: ReturnType<typeof deferred>;
  };
  private releases: Array<() => void> = [];
  failGateCas = false;
  readonly counts: Record<PromotionRacePoint, number> = {
    JOURNAL_FENCE: 0,
    CALLBACK_SETTLE: 0,
    CONTROL_FENCE: 0,
    UPLOAD_FENCE: 0,
    UPLOAD_SEAL: 0,
    GATE_WRITE: 0,
  };

  arm(point: PromotionRacePoint) {
    if (this.pause) throw new Error('A promotion barrier is already armed');
    const entered = deferred(),
      resume = deferred();
    this.pause = { point, entered, resume };
    this.releases.push(resume.resolve);
    return {
      entered: () => bounded(entered.promise, `${point}:entered`),
      release: resume.resolve,
    };
  }

  async before(point: PromotionRacePoint): Promise<void> {
    this.counts[point]++;
    const pause = this.pause;
    if (!pause || pause.point !== point) return;
    this.pause = undefined; // Driver retries must not pause again.
    pause.entered.resolve();
    await bounded(pause.resume.promise, `${point}:resume`);
  }

  releaseAll(): void {
    this.pause = undefined;
    for (const release of this.releases) release();
    this.releases = [];
    this.failGateCas = false;
  }
}
