import type { MeterSegment } from '../local-core/artifact';
import type { ResolvedPracticeTempoPlan } from '../local-core/practice-tempo';

export interface MetronomeControllerOptions {
  tempoPlan: ResolvedPracticeTempoPlan;
  meterSegments?: readonly MeterSegment[];
  enabled?: boolean;
  audioContext?: AudioContext | null;
}

export class MetronomeController {
  private tempoPlan: ResolvedPracticeTempoPlan;
  private meterSegments: readonly MeterSegment[];
  private isEnabled: boolean;
  private isRunning = false;
  private audioContext: AudioContext | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private nextBeatTime = 0;
  private audioAvailable = true;

  private static readonly LOOKAHEAD_MS = 25;
  private static readonly SCHEDULE_AHEAD_SEC = 0.1;
  private static readonly ACCENT_FREQ_HZ = 1200;
  private static readonly BEAT_FREQ_HZ = 800;
  private static readonly ACCENT_DECAY_SEC = 0.03;
  private static readonly BEAT_DECAY_SEC = 0.02;

  constructor(options: MetronomeControllerOptions) {
    this.tempoPlan = options.tempoPlan;
    this.meterSegments = options.meterSegments ?? [];
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

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled && this.isRunning) {
      this.ensureAudioContext();
    }
  }

  setTempoPlan(tempoPlan: ResolvedPracticeTempoPlan): void {
    this.tempoPlan = tempoPlan;
  }

  setMeterSegments(meterSegments: readonly MeterSegment[]): void {
    this.meterSegments = meterSegments;
  }

  prepare(): void {
    this.ensureAudioContext();
  }

  start(initialBeat = 0): void {
    if (this.isRunning) {
      this.stop();
    }
    this.ensureAudioContext();
    this.isRunning = true;
    this.nextBeat = Math.max(0, Math.ceil(initialBeat));

    const ctx = this.audioContext;
    const now = ctx ? ctx.currentTime : 0;
    this.nextBeatTime = now + 0.05;

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

  resume(currentBeat: number): void {
    if (this.isRunning) {
      return;
    }
    this.ensureAudioContext();
    this.isRunning = true;

    const boundedBeat = Math.max(0, currentBeat);
    const nextIntegerBeat = Math.ceil(boundedBeat);
    const fractionUntilNext = nextIntegerBeat === boundedBeat ? 1 : nextIntegerBeat - boundedBeat;
    this.nextBeat = nextIntegerBeat === boundedBeat ? boundedBeat + 1 : nextIntegerBeat;

    const bpm = this.bpmAtBeat(boundedBeat);
    const secondsUntilNext = (fractionUntilNext * 60) / bpm;

    const ctx = this.audioContext;
    const now = ctx ? ctx.currentTime : 0;
    this.nextBeatTime = now + Math.max(0.01, secondsUntilNext);

    this.timerId = setInterval(() => this.tick(), MetronomeController.LOOKAHEAD_MS);
    this.tick();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.nextBeat = 0;
    this.nextBeatTime = 0;
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

  private tick(): void {
    if (!this.isRunning || !this.audioAvailable) {
      return;
    }
    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    const horizon = ctx.currentTime + MetronomeController.SCHEDULE_AHEAD_SEC;
    while (this.nextBeatTime < horizon) {
      if (this.isEnabled) {
        this.scheduleClick(this.nextBeat, this.nextBeatTime);
      }
      const bpm = this.bpmAtBeat(this.nextBeat);
      const secondsPerBeat = 60 / bpm;
      this.nextBeatTime += secondsPerBeat;
      this.nextBeat += 1;
    }
  }

  private scheduleClick(beat: number, time: number): void {
    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    try {
      const isAccent = this.isDownbeat(beat);
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

  private isDownbeat(beat: number): boolean {
    if (!this.meterSegments || this.meterSegments.length === 0) {
      const measureDuration = 4;
      const pos = ((beat % measureDuration) + measureDuration) % measureDuration;
      return pos < 0.001 || Math.abs(pos - measureDuration) < 0.001;
    }

    let active = this.meterSegments[0];
    for (const segment of this.meterSegments) {
      if (segment.startBeat <= beat) {
        active = segment;
      } else {
        break;
      }
    }

    const duration = active.measureDurationBeats > 0 ? active.measureDurationBeats : 4;
    const offset = beat - active.startBeat;
    const pos = ((offset % duration) + duration) % duration;
    return pos < 0.001 || Math.abs(pos - duration) < 0.001;
  }

  private bpmAtBeat(beat: number): number {
    const segments = this.tempoPlan.segments;
    if (!segments || segments.length === 0) {
      return 80;
    }
    let active = segments[0];
    for (const segment of segments) {
      if (segment.startBeat <= beat) {
        active = segment;
      } else {
        break;
      }
    }
    return active.bpm > 0 ? active.bpm : 80;
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
