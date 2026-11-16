import { bounded, deferred } from './write-race-gate';
export type FlowPoint =
  | 'CONSUME'
  | 'REJECT'
  | 'DEVICE_FENCE'
  | 'RESPONSE'
  | 'FANOUT'
  | 'NOTICE'
  | 'ATTEMPT';
/** Middleware pauses/throws before a real query; never supplies database results. */
export class FlowRaceGate {
  private pause?: {
    point: FlowPoint;
    entered: ReturnType<typeof deferred>;
    resume: ReturnType<typeof deferred>;
  };
  private releases: Array<() => void> = [];
  fail?: FlowPoint;
  arm(point: FlowPoint) {
    if (this.pause) throw new Error('A flow barrier is already armed');
    const entered = deferred(),
      resume = deferred();
    this.pause = { point, entered, resume };
    this.releases.push(resume.resolve);
    return {
      entered: () => bounded(entered.promise, `${point}:entered`),
      release: resume.resolve,
    };
  }
  async before(point: FlowPoint): Promise<void> {
    if (this.fail === point) {
      this.fail = undefined;
      throw new Error(`Injected flow failure at ${point}`);
    }
    const pause = this.pause;
    if (!pause || pause.point !== point) return;
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
