import type { MeterSegment, PracticeScoreArtifact } from '../local-core/artifact';
import { roundBeat } from '../local-core/artifact';
import type { ResolvedPracticeTempoPlan } from '../local-core/practice-tempo';
import { beatsToMs, PracticeTempoTimeline } from '../local-core/practice-tempo';
import {
  isDownbeat,
  meterAtBeat,
  pulseStepBeats,
} from './metronome-pulse-planner';

export type MetronomeMode = 'CONTINUOUS' | 'STEP';
export type ContinuousMetronomePhase = 'COUNT_IN' | 'RUNNING';

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
}

export class MetronomeController {
  private artifact: PracticeScoreArtifact;
  private tempoPlan: ResolvedPracticeTempoPlan;
  private timeline: PracticeTempoTimeline;
  private meterSegments: readonly MeterSegment[];
  private metronomeMode: MetronomeMode;
  private continuousPhase: ContinuousMetronomePhase = 'RUNNING';
  private scopeStartBeat: number;
  private scopeEndBeat: number;
  private countInPulses: number;
  private countInBeats: number;
  private isEnabled: boolean;
  private isRunning = false;
  private audioContext: AudioContext | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private audioAvailable = true;

  // CONTINUOUS mode state
  private currentBeat = 0;
  private currentCountInIndex = 0;

  // STEP mode state
  private stepTargetOnsetBeat = 0;
  private stepPulseCounter = 0;

  // Scheduling clock
  private nextPulseTime = 0;

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
        schemaVersion: 2,
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

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled && this.isRunning) {
      this.ensureAudioContext();
    }
  }

  setMode(mode: MetronomeMode): void {
    this.metronomeMode = mode;
  }

  setContinuousPhase(phase: ContinuousMetronomePhase): void {
    this.continuousPhase = phase;
  }

  setStepContext(targetOnsetBeat: number): void {
    const boundedBeat = Math.max(0, targetOnsetBeat);
    if (this.stepTargetOnsetBeat !== boundedBeat) {
      this.stepTargetOnsetBeat = boundedBeat;
      this.stepPulseCounter = 0;
    }
  }

  setTempoPlan(tempoPlan: ResolvedPracticeTempoPlan): void {
    if (!tempoPlan || !Array.isArray(tempoPlan.segments) || tempoPlan.segments.length === 0) {
      throw new Error('MetronomeController requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.tempoPlan = tempoPlan;
    this.timeline = new PracticeTempoTimeline(tempoPlan, this.artifact.scoreEndBeat);
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
    initialBeat = 0,
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

    if (options?.countInPulses !== undefined) {
      this.countInPulses = options.countInPulses;
    }
    if (options?.countInBeats !== undefined) {
      this.countInBeats = options.countInBeats;
    }

    const ctx = this.audioContext;
    const now = ctx ? ctx.currentTime : 0;
    this.nextPulseTime = now + 0.05;

    if (this.metronomeMode === 'STEP') {
      this.stepTargetOnsetBeat = Math.max(0, initialBeat);
      this.stepPulseCounter = 0;
    } else {
      if (options?.countIn && this.countInPulses > 0 && this.countInBeats > 0) {
        this.continuousPhase = 'COUNT_IN';
        this.currentCountInIndex = 0;
      } else {
        this.continuousPhase = 'RUNNING';
        this.currentBeat = Math.max(0, initialBeat);
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

  resume(currentBeat?: number): void {
    if (this.isRunning) {
      return;
    }
    this.ensureAudioContext();
    this.isRunning = true;

    const ctx = this.audioContext;
    const now = ctx ? ctx.currentTime : 0;

    if (this.metronomeMode === 'STEP') {
      this.stepTargetOnsetBeat = Math.max(0, currentBeat ?? this.stepTargetOnsetBeat);
      this.stepPulseCounter = 0;
      this.nextPulseTime = now + 0.05;
    } else {
      this.continuousPhase = 'RUNNING';
      const bounded = Math.max(0, currentBeat ?? this.currentBeat);
      const meter = meterAtBeat(this.artifact, bounded);
      const step = pulseStepBeats(meter);
      const k = Math.ceil(roundBeat((bounded - meter.startBeat) / step));
      const nextBeat = roundBeat(meter.startBeat + k * step);
      const fractionUntilNext = Math.abs(nextBeat - bounded) < 1e-4 ? step : nextBeat - bounded;
      this.currentBeat = Math.abs(nextBeat - bounded) < 1e-4 ? roundBeat(bounded + step) : nextBeat;
      const bpm = this.timeline.bpmAtBeat(bounded);
      const secondsUntilNext = beatsToMs(fractionUntilNext, bpm) / 1000;
      this.nextPulseTime = now + Math.max(0.01, secondsUntilNext);
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
    this.nextPulseTime = 0;
    this.currentBeat = 0;
    this.currentCountInIndex = 0;
    this.stepPulseCounter = 0;
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
    if (!this.isRunning || !this.audioAvailable) {
      return;
    }
    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    const horizon = ctx.currentTime + MetronomeController.SCHEDULE_AHEAD_SEC;

    if (this.metronomeMode === 'STEP') {
      const meter = meterAtBeat(this.artifact, this.stepTargetOnsetBeat);
      const step = pulseStepBeats(meter);
      const bpm = this.timeline.bpmAtBeat(this.stepTargetOnsetBeat);
      const secondsPerPulse = beatsToMs(step, bpm) / 1000;

      while (this.nextPulseTime < horizon) {
        if (this.isEnabled) {
          const virtualBeat = roundBeat(this.stepTargetOnsetBeat + this.stepPulseCounter * step);
          const isAccent = isDownbeat(meter, virtualBeat);
          this.scheduleClick(isAccent, this.nextPulseTime);
        }
        this.nextPulseTime += secondsPerPulse;
        this.stepPulseCounter += 1;
      }
      return;
    }

    // CONTINUOUS mode
    if (this.continuousPhase === 'COUNT_IN') {
      const meterAtStart = meterAtBeat(this.artifact, this.scopeStartBeat);
      const bpmAtStart = this.timeline.bpmAtBeat(this.scopeStartBeat);
      const countInTotalMs = beatsToMs(this.countInBeats, bpmAtStart);
      const secondsPerPulse = (countInTotalMs / this.countInPulses) / 1000;

      while (this.continuousPhase === 'COUNT_IN' && this.nextPulseTime < horizon) {
        if (this.isEnabled) {
          const isAccent = (this.currentCountInIndex % meterAtStart.numerator) === 0;
          this.scheduleClick(isAccent, this.nextPulseTime);
        }
        this.nextPulseTime += secondsPerPulse;
        this.currentCountInIndex += 1;

        if (this.currentCountInIndex >= this.countInPulses) {
          this.continuousPhase = 'RUNNING';
          this.currentBeat = this.scopeStartBeat;
          break;
        }
      }
    }

    if (this.continuousPhase === 'RUNNING') {
      while (this.nextPulseTime < horizon && this.currentBeat <= this.scopeEndBeat + 1e-4) {
        const meter = meterAtBeat(this.artifact, this.currentBeat);
        const step = pulseStepBeats(meter);
        const isAccent = isDownbeat(meter, this.currentBeat);

        if (this.isEnabled) {
          this.scheduleClick(isAccent, this.nextPulseTime);
        }

        const bpm = this.timeline.bpmAtBeat(this.currentBeat);
        const secondsPerPulse = beatsToMs(step, bpm) / 1000;
        this.nextPulseTime += secondsPerPulse;
        this.currentBeat = roundBeat(this.currentBeat + step);
      }
    }
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
