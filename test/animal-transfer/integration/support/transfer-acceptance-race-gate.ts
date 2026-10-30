import { bounded, deferred } from './write-race-gate';
export type AcceptancePoint =
  | 'SNAPSHOT'
  | 'ACQUIRE'
  | 'FENCE'
  | 'DECISION'
  | 'ITEM'
  | 'CLAIM'
  | 'HEADER'
  | 'REJECT_ITEMS'
  | 'RELEASE_CLAIMS'
  | 'EVENT'
  | 'PROFILE';
/** Pauses/throws BEFORE real driver operations; no fabricated query/commit results. */
export class AcceptanceRaceGate {
  private pause?: {
    point: AcceptancePoint;
    entered: ReturnType<typeof deferred>;
    resume: ReturnType<typeof deferred>;
  };
  private releases: Array<() => void> = [];
  fail?: AcceptancePoint;
  arm(point: AcceptancePoint) {
    if (this.pause) throw new Error('An acceptance barrier is already armed');
    const entered = deferred(),
      resume = deferred();
    this.pause = { point, entered, resume };
    this.releases.push(resume.resolve);
    return {
      entered: () => bounded(entered.promise, `${point}:entered`),
      release: resume.resolve,
    };
  }
  async before(point: AcceptancePoint) {
    if (this.fail === point) {
      this.fail = undefined;
      throw new Error(`Injected acceptance failure at ${point}`);
    }
    const pause = this.pause;
    if (pause?.point !== point) return;
    this.pause = undefined;
    pause.entered.resolve();
    await bounded(pause.resume.promise, `${point}:resume`);
  }
  releaseAll() {
    this.pause = undefined;
    this.fail = undefined;
    for (const release of this.releases) release();
    this.releases = [];
  }
}
