import { PracticeTempoTimeline } from '@/lib/practice/kernel/tempo';
import type { ResolvedMetronomePlan } from './metronome-plan';
import type { MetronomeAudioPort } from './metronome-audio-port';
import { MetronomePulsePlanner, type MetronomePlanningCursor, type ContinuousMetronomeSyncPoint } from './metronome-pulse-planner';

/** One attempt's scheduling state over resolved musical truth and an optional audio port. */
export class MetronomeRuntime {
  private readonly timeline: PracticeTempoTimeline;
  private isEnabled: boolean;
  private isRunning = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor: MetronomePlanningCursor | null = null;
  private static readonly LOOKAHEAD_MS = 25;
  private static readonly SCHEDULE_AHEAD_SEC = 0.1;
  constructor(private readonly plan: ResolvedMetronomePlan, private readonly audio: MetronomeAudioPort) {
    this.timeline = new PracticeTempoTimeline(plan.tempoPlan, plan.timelineEndTick, plan.ticksPerQuarter);
    this.isEnabled = plan.initiallyEnabled;
  }
  get enabled(): boolean { return this.isEnabled; }
  get running(): boolean { return this.isRunning; }
  get planningCursor(): MetronomePlanningCursor | null { return this.cursor && Object.freeze({ ...this.cursor }); }
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.isEnabled = enabled;
    if (enabled && this.isRunning) { this.activate(); this.tick(); }
  }
  setStepContext(targetOnsetTick: number): void {
    if (this.disposed || this.plan.mode !== 'STEP') return;
    this.cursor = MetronomePulsePlanner.createStepCursor(targetOnsetTick, this.plan, this.timeline, this.audio.nowMs() + 50);
  }
  syncContinuous(syncPoint: ContinuousMetronomeSyncPoint): void {
    if (this.disposed || this.plan.mode !== 'CONTINUOUS') return;
    this.cursor = MetronomePulsePlanner.createContinuousCursor(syncPoint, this.plan, this.timeline, this.audio.nowMs());
  }
  start(context: number | ContinuousMetronomeSyncPoint): void {
    if (this.disposed) return;
    if (this.isRunning) this.stop();
    this.activate(); this.isRunning = true;
    this.synchronize(context);
    this.timer = setInterval(() => this.tick(), MetronomeRuntime.LOOKAHEAD_MS); this.tick();
  }
  pause(): void {
    this.isRunning = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
  resume(context: number | ContinuousMetronomeSyncPoint): void {
    if (this.disposed || this.isRunning) return;
    this.activate(); this.isRunning = true; this.synchronize(context);
    this.timer = setInterval(() => this.tick(), MetronomeRuntime.LOOKAHEAD_MS); this.tick();
  }
  stop(): void { this.pause(); this.cursor = null; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.stop();
    try { void Promise.resolve(this.audio.dispose()).catch(() => {}); } catch { /* Optional aid cannot block critical release. */ }
  }
  private synchronize(context: number | ContinuousMetronomeSyncPoint): void {
    if (this.plan.mode === 'STEP' && typeof context === 'number') this.setStepContext(context);
    else if (this.plan.mode === 'CONTINUOUS' && typeof context === 'object') this.syncContinuous(context);
    else throw new Error('Metronome sync must match the resolved mode.');
  }
  private activate(): void { try { this.audio.activate(); } catch { /* Nonfatal audio port. */ } }
  private tick(): void {
    if (this.disposed || !this.isRunning || !this.cursor) return;
    const { pulses, nextCursor } = MetronomePulsePlanner.planNextPulses(this.cursor,
      this.audio.nowMs() + MetronomeRuntime.SCHEDULE_AHEAD_SEC * 1000,
      { artifact: this.plan, timeline: this.timeline, scopeEndTick: this.plan.scopeEndTick });
    for (const pulse of pulses) if (this.isEnabled) {
      try { this.audio.scheduleClick({ atMs: pulse.timeMs, accent: pulse.isDownbeat }); } catch { /* Optional click fault. */ }
    }
    this.cursor = nextCursor;
  }
}
