export type PracticeStartupPhase = 'resourceBindingOpen' | 'waitPreviousRelease' | 'acquireInferenceLease'
  | 'audioContextResume' | 'firLoad' | 'captureConnect' | 'acousticPreroll' | 'midiBind' | 'recorderAdmission';

/** Bounded engineering diagnostics for one fresh attempt, never product/result data. */
export class PracticeStartupTimings {
  private readonly phases: Readonly<{ phase: PracticeStartupPhase; durationMs: number; outcome: 'SUCCEEDED' | 'FAILED' }>[] = [];
  constructor(private readonly now: () => number = () => performance.now()) {}
  async measure<T>(phase: PracticeStartupPhase, action: () => Promise<T>): Promise<T> {
    const start = this.now(); let outcome: 'SUCCEEDED' | 'FAILED' = 'FAILED';
    try { const result = await action(); outcome = 'SUCCEEDED'; return result; }
    finally { if (this.phases.length < 16) this.phases.push(Object.freeze({ phase, durationMs: Math.max(0, this.now() - start), outcome })); }
  }
  snapshot() { return Object.freeze([...this.phases]); }
}
