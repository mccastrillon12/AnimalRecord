import { bounded, deferred } from './write-race-gate';

export type EvidenceRacePoint = 'CONTROL' | 'HEADER' | 'RUN';

/** Only pauses real queries; does not replace Mongo results or transactions. */
export class EvidenceRaceGate {
  private pause?: {
    point: EvidenceRacePoint;
    entered: ReturnType<typeof deferred>;
    resume: ReturnType<typeof deferred>;
  };
  private releases: Array<() => void> = [];
  failRunCas = false;

  arm(point: EvidenceRacePoint) {
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

  async before(point: EvidenceRacePoint): Promise<void> {
    const pause = this.pause;
    if (!pause || pause.point !== point) return;
    this.pause = undefined;
    pause.entered.resolve();
    await bounded(pause.resume.promise, `${point}:resume`);
  }

  releaseAll(): void {
    this.pause = undefined;
    for (const release of this.releases) release();
    this.releases = [];
  }
}
