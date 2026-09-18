import type { MeterSegment, PracticeScoreArtifact } from '../local-core/artifact';
import type { PerformanceClockSnapshot } from '../local-core/performance-runtime';
import type { ResolvedPracticeTempoPlan } from '../local-core/practice-tempo';
import { beatsToMs, PracticeTempoTimeline } from '../local-core/practice-tempo';
import type {
  ContinuousMetronomeSyncPoint,
  MetronomePlanningCursor,
  MetronomePulse,
} from './metronome-pulse-planner';
import {
  isDownbeat,
  meterAtBeat,
  MetronomePulsePlanner,
} from './metronome-pulse-planner';

export type MetronomeMode = 'CONTINUOUS' | 'STEP';

export interface MetronomeControllerOptions {
  artifact?: PracticeScoreArtifact;
  tempoPlan: ResolvedPracticeTempoPlan;
  meterSegments?: readonly MeterSegment[];
  mode?: MetronomeMode;
  scopeStartBeat?: number;
  scopeEndBeat?: number;
  countInPulses?: number;
  countInBeats?: number;
  enabled?: boolean;
  audioContext?: AudioContext | null;
  onScheduledPulse?: (pulse: MetronomePulse, audioTime: number) => void;
}

export class MetronomeController {
  private artifact: PracticeScoreArtifact;
  private tempoPlan: ResolvedPracticeTempoPlan;
  private timeline: PracticeTempoTimeline;
  private meterSegments: readonly MeterSegment[];
  private metronomeMode: MetronomeMode;
  private scopeStartBeat: number;
  private scopeEndBeat: number;
  private countInPulses: number;
  private countInBeats: number;
  private isEnabled: boolean;
  private isRunning = false;
  private audioContext: AudioContext | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private audioAvailable = true;
  private onScheduledPulse?: (pulse: MetronomePulse, audioTime: number) => void;

  // Single musical timing authority cursor
  private cursor: MetronomePlanningCursor | null = null;
  private lastTickAudioTime = 0;

  private static readonly LOOKAHEAD_MS = 25;
  private static readonly SCHEDULE_AHEAD_SEC = 0.1;
  private static readonly ACCENT_FREQ_HZ = 1200;
  private static readonly BEAT_FREQ_HZ = 800;
  private static readonly ACCENT_DECAY_SEC = 0.03;
  private static readonly BEAT_DECAY_SEC = 0.02;

  constructor(options: MetronomeControllerOptions) {
    if (!options.tempoPlan || !Array.isArray(options.tempoPlan.segments) || options.tempoPlan.segments.length === 0) {
      throw new Error('MetronomeController requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.tempoPlan = options.tempoPlan;
    this.metronomeMode = options.mode ?? 'CONTINUOUS';
    this.scopeStartBeat = Math.max(0, options.scopeStartBeat ?? 0);
    this.countInPulses = Math.max(0, options.countInPulses ?? 0);
    this.countInBeats = Math.max(0, options.countInBeats ?? 0);
    this.onScheduledPulse = options.onScheduledPulse;

    if (options.artifact) {
      this.artifact = options.artifact;
      this.meterSegments = options.artifact.meterSegments;
      this.scopeEndBeat = options.scopeEndBeat ?? options.artifact.scoreEndBeat;
    } else {
      const meterSegments = options.meterSegments ?? [
        {
          startBeat: 0,
          numerator: 4,
          denominator: 4,
          measureDurationBeats: 4,
          countInPulses: 4,
        },
      ];
      this.meterSegments = meterSegments;
      this.scopeEndBeat = options.scopeEndBeat ?? 1000;
      this.artifact = {
        schemaVersion: 1,
        scoreId: 'inline',
        revisionId: 'inline',
        artifactId: 'inline',
        playableEvents: [],
        expectedPracticeGroups: [],
        practiceAttackSteps: [],
        meterSegments: [...meterSegments],
        scoreTempoSegments: [...options.tempoPlan.segments],
        firstPlayableBeat: 0,
        scoreEndBeat: this.scopeEndBeat,
      };
    }

    this.timeline = new PracticeTempoTimeline(this.tempoPlan, this.artifact.scoreEndBeat);
    this.isEnabled = options.enabled ?? false;
    if (options.audioContext !== undefined) {
      this.audioContext = options.audioContext;
    }
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  get running(): boolean {
    return this.isRunning;
  }

  get mode(): MetronomeMode {
    return this.metronomeMode;
  }

  get planningCursor(): MetronomePlanningCursor | null {
    return this.cursor;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled && this.isRunning) {
      this.ensureAudioContext();
      this.lastTickAudioTime = this.audioContext?.currentTime ?? 0;
      this.tick();
    }
  }

  setMode(mode: MetronomeMode): void {
    this.metronomeMode = mode;
  }

  setStepContext(targetOnsetBeat: number): void {
    const nowMs = (this.audioContext?.currentTime ?? 0) * 1000;
    this.cursor = MetronomePulsePlanner.createStepCursor(
      targetOnsetBeat,
      this.artifact,
      this.timeline,
      nowMs + 50
    );
    this.lastTickAudioTime = this.audioContext?.currentTime ?? 0;
  }

  syncContinuous(syncPoint: ContinuousMetronomeSyncPoint | PerformanceClockSnapshot): void {
    const nowMs = (this.audioContext?.currentTime ?? 0) * 1000;
    this.cursor = MetronomePulsePlanner.createContinuousCursor(
      syncPoint,
      this.artifact,
      this.timeline,
      nowMs
    );
    this.lastTickAudioTime = this.audioContext?.currentTime ?? 0;
  }

  setTempoPlan(tempoPlan: ResolvedPracticeTempoPlan): void {
    if (!tempoPlan || !Array.isArray(tempoPlan.segments) || tempoPlan.segments.length === 0) {
      throw new Error('MetronomeController requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.tempoPlan = tempoPlan;
    this.timeline = new PracticeTempoTimeline(tempoPlan, this.artifact.scoreEndBeat);
    const nowMs = (this.audioContext?.currentTime ?? 0) * 1000;
    if (this.cursor) {
      if (this.cursor.phase === 'STEP') {
        this.cursor = MetronomePulsePlanner.createStepCursor(
          this.cursor.targetOnsetBeat,
          this.artifact,
          this.timeline,
          nowMs
        );
      } else if (this.cursor.phase === 'RUNNING') {
        this.cursor = MetronomePulsePlanner.createContinuousCursor(
          { state: 'RUNNING', musicalBeat: this.cursor.currentBeat },
          this.artifact,
          this.timeline,
          nowMs
        );
      }
    }
  }

  setMeterSegments(meterSegments: readonly MeterSegment[]): void {
    this.meterSegments = meterSegments;
    this.artifact = {
      ...this.artifact,
      meterSegments: [...meterSegments],
    };
  }

  prepare(): void {
    this.ensureAudioContext();
  }

  start(
    initialContext: ContinuousMetronomeSyncPoint | PerformanceClockSnapshot | number = 0,
    options?: {
      countIn?: boolean;
      countInPulses?: number;
      countInBeats?: number;
    }
  ): void {
    if (this.isRunning) {
      this.stop();
    }
    this.ensureAudioContext();
    this.isRunning = true;
    const nowSec = this.audioContext?.currentTime ?? 0;
    this.lastTickAudioTime = nowSec;
    const nowMs = nowSec * 1000;
    const baseTimeMs = nowMs + 50;

    if (options?.countInPulses !== undefined) {
      this.countInPulses = options.countInPulses;
    }
    if (options?.countInBeats !== undefined) {
      this.countInBeats = options.countInBeats;
    }

    if (this.metronomeMode === 'STEP') {
      const onsetBeat = typeof initialContext === 'number' ? initialContext : this.scopeStartBeat;
      this.cursor = MetronomePulsePlanner.createStepCursor(onsetBeat, this.artifact, this.timeline, baseTimeMs);
    } else {
      if (typeof initialContext === 'object' && initialContext !== null && 'state' in initialContext) {
        this.cursor = MetronomePulsePlanner.createContinuousCursor(
          initialContext,
          this.artifact,
          this.timeline,
          nowMs
        );
      } else {
        const initialBeat = typeof initialContext === 'number' ? initialContext : this.scopeStartBeat;
        if (options?.countIn && this.countInPulses > 0 && this.countInBeats > 0) {
          const bpmAtStart = this.timeline.bpmAtBeat(this.scopeStartBeat);
          const countInTotalMs = beatsToMs(this.countInBeats, bpmAtStart);
          this.cursor = MetronomePulsePlanner.createContinuousCursor(
            {
              state: 'COUNT_IN',
              scopeStartBeat: this.scopeStartBeat,
              countInTotalMs,
              countInRemainingMs: countInTotalMs,
              countInPulses: this.countInPulses,
              countInPulse: 1,
            },
            this.artifact,
            this.timeline,
            baseTimeMs
          );
        } else {
          this.cursor = MetronomePulsePlanner.createContinuousCursor(
            {
              state: 'RUNNING',
              musicalBeat: initialBeat,
            },
            this.artifact,
            this.timeline,
            baseTimeMs
          );
        }
      }
    }

    this.timerId = setInterval(() => this.tick(), MetronomeController.LOOKAHEAD_MS);
    this.tick();
  }

  pause(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  resume(syncPoint?: ContinuousMetronomeSyncPoint | PerformanceClockSnapshot | number): void {
    if (this.isRunning) {
      return;
    }
    this.ensureAudioContext();
    this.isRunning = true;
    const nowSec = this.audioContext?.currentTime ?? 0;
    this.lastTickAudioTime = nowSec;
    const nowMs = nowSec * 1000;
    const baseTimeMs = nowMs + 50;

    if (this.metronomeMode === 'STEP') {
      const onsetBeat = typeof syncPoint === 'number'
        ? syncPoint
        : (this.cursor?.phase === 'STEP' ? this.cursor.targetOnsetBeat : this.scopeStartBeat);
      this.cursor = MetronomePulsePlanner.createStepCursor(onsetBeat, this.artifact, this.timeline, baseTimeMs);
    } else {
      if (typeof syncPoint === 'object' && syncPoint !== null && 'state' in syncPoint) {
        this.cursor = MetronomePulsePlanner.createContinuousCursor(
          syncPoint,
          this.artifact,
          this.timeline,
          nowMs
        );
      } else {
        const beat = typeof syncPoint === 'number'
          ? syncPoint
          : (this.cursor?.phase === 'RUNNING' ? this.cursor.currentBeat : this.scopeStartBeat);
        this.cursor = MetronomePulsePlanner.createContinuousCursor(
          { state: 'RUNNING', musicalBeat: beat },
          this.artifact,
          this.timeline,
          baseTimeMs
        );
      }
    }

    this.timerId = setInterval(() => this.tick(), MetronomeController.LOOKAHEAD_MS);
    this.tick();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.cursor = null;
    this.lastTickAudioTime = 0;
  }

  destroy(): void {
    this.stop();
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      try {
        this.audioContext.close().catch(() => {});
      } catch {
        // Safe disposal
      }
      this.audioContext = null;
    }
  }

  bpmAtBeat(beat: number): number {
    return this.timeline.bpmAtBeat(beat);
  }

  isDownbeat(beat: number): boolean {
    const meter = meterAtBeat(this.artifact, beat);
    return isDownbeat(meter, beat);
  }

  private tick(): void {
    if (!this.isRunning || !this.audioAvailable || !this.cursor) {
      return;
    }
    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    const now = ctx.currentTime;
    this.lastTickAudioTime = now;

    const horizonMs = (now + MetronomeController.SCHEDULE_AHEAD_SEC) * 1000;
    const { pulses, nextCursor } = MetronomePulsePlanner.planNextPulses(
      this.cursor,
      horizonMs,
      {
        artifact: this.artifact,
        timeline: this.timeline,
        scopeEndBeat: this.scopeEndBeat,
      }
    );

    for (const pulse of pulses) {
      const audioTime = pulse.timeMs / 1000;
      if (this.isEnabled) {
        this.scheduleClick(pulse.isDownbeat, audioTime);
      }
      if (this.onScheduledPulse) {
        this.onScheduledPulse(pulse, audioTime);
      }
    }

    this.cursor = nextCursor;
  }

  private scheduleClick(isAccent: boolean, time: number): void {
    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    try {
      const freq = isAccent ? MetronomeController.ACCENT_FREQ_HZ : MetronomeController.BEAT_FREQ_HZ;
      const decay = isAccent ? MetronomeController.ACCENT_DECAY_SEC : MetronomeController.BEAT_DECAY_SEC;
      const gainVal = isAccent ? 1.0 : 0.5;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(gainVal, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + decay + 0.01);
    } catch {
      // Ignore click generation errors without crashing practice
    }
  }

  private ensureAudioContext(): void {
    if (this.audioContext || !this.audioAvailable) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioContextClass =
        typeof window !== 'undefined'
          ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : null;

      if (!AudioContextClass) {
        this.audioAvailable = false;
        return;
      }

      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    } catch {
      this.audioAvailable = false;
    }
  }
}
