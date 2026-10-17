import { StepPracticeRuntime, groupForCurrentStep } from '../local-core/step-runtime';
import { PracticeTimebase } from '../local-core/timebase';
import { createLocalSessionId, type LocalStepSessionSnapshot } from '../local-core/session';
import { resolvePracticeScope, type PracticeInputSource, type PracticeScope, type PracticeScoreArtifact } from '../local-core/artifact';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '../local-core/practice-tempo';
import type { BrowserMidiState } from '../midi/browser-midi-controller';
import { STEP_ANALYSIS_UNAVAILABLE_REASON } from '../input-capability-reasons';
import { browserStepPlatform, type StepMidiPort, type StepMetronomePort, type StepPlatform } from './step-platform';
import { StepMidiAttemptInput } from './step-midi-attempt-input';
import { stepApplicationError, type StepApplicationErrorCode } from './step-errors';

export type StepControllerOptions = Readonly<{
  artifact: PracticeScoreArtifact; scope: PracticeScope; inputSource: PracticeInputSource;
  tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  onCompletion?(snapshot: LocalStepSessionSnapshot): void; platform?: StepPlatform;
}>;
export type StepControllerState = 'READY' | 'PREPARING' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'DISPOSED';

/** The sole STEP application owner. Restart means constructing a fresh owner. */
export class StepPracticeController {
  private readonly platform: StepPlatform;
  private runtime: StepPracticeRuntime | null = null;
  private midi: StepMidiPort | null = null;
  private metronome: StepMetronomePort | null = null;
  private input: StepMidiAttemptInput | null = null;
  private state: StepControllerState = 'READY';
  private error: StepApplicationErrorCode | null = null;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private suppressInputState = false;
  private activeAt: number | null = null;
  private elapsedMs = 0;
  private enabled: boolean;
  private finalSnapshot: LocalStepSessionSnapshot | null = null;
  constructor(private readonly options: StepControllerOptions) {
    this.platform = options.platform ?? browserStepPlatform(); this.enabled = options.metronomeEnabled ?? false;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot() {
    return Object.freeze({ state: this.state, error: this.error,
      elapsedSeconds: Math.floor((this.elapsedMs + (this.activeAt === null ? 0 : this.platform.clock.nowMs() - this.activeAt)) / 1000),
      activeStepGroup: this.runtime ? groupForCurrentStep(this.runtime) : null,
      sessionSnapshot: this.runtime?.snapshot() ?? this.finalSnapshot,
      lastSnapshot: this.finalSnapshot, inputDiagnostics: this.input?.snapshot() ?? null });
  }
  async start(): Promise<void> {
    if (this.state !== 'READY') return;
    if (this.options.inputSource === 'MICROPHONE') { this.error = STEP_ANALYSIS_UNAVAILABLE_REASON; this.emit(); return; }
    const generation = ++this.generation; this.state = 'PREPARING'; this.error = null; this.emit();
    try {
      const localSessionId = createLocalSessionId('step'), timebase = new PracticeTimebase({ domainId: localSessionId });
      const runtime = new StepPracticeRuntime({ ...this.options, clock: this.platform.clock, timebase, localSessionId });
      this.runtime = runtime;
      const scope = resolvePracticeScope(this.options.artifact, this.options.scope);
      this.metronome = this.platform.createMetronome({ artifact: this.options.artifact,
        tempoPlan: resolvePracticeTempoPlan(this.options.artifact, this.options.tempoSelection ?? { mode: 'SCORE' }),
        mode: 'STEP', scopeStartBeat: scope.startBeat, scopeEndBeat: scope.terminalBeat, enabled: this.enabled });
      this.input = new StepMidiAttemptInput({
        open: time => {
          if (this.state !== 'ACTIVE') return null;
          const identity = runtime.openAttempt(time);
          if (identity) this.emit();
          return this.state === 'ACTIVE' && runtime.snapshot().step.activeAttempt?.attemptId === identity?.attemptId ? identity : null;
        },
        complete: (identity, evidence) => {
          if (this.state !== 'ACTIVE' || !runtime.analyzeAttempt(identity)) return;
          this.emit();
          const result = runtime.completeAttempt(identity, evidence);
          if (result.kind === 'REJECTED') return;
          this.emit();
          if (runtime.isCompleted) this.complete();
          else { runtime.rearm(); if (result.record.verdict === 'MATCH') this.updateTarget(); this.emit(); }
        },
        failure: error => this.failAttempt(error),
      }, this.platform.timer);
      this.midi = this.platform.createMidi({ timebase, onMidiNote: note => this.input?.note(note), onStateChange: state => this.inputState(state) });
      await this.midi.start();
      if (generation !== this.generation) return;
      this.state = 'ACTIVE'; this.activeAt = this.platform.clock.nowMs(); this.updateTarget();
      this.metronome?.start(runtime.currentOnsetBeat); this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = stepApplicationError(error); this.cleanup(); this.runtime = null; this.state = 'READY'; this.emit();
    }
  }
  pause(): void {
    if (this.state !== 'ACTIVE') return;
    this.holdElapsed(); this.input?.cancel(); this.runtime?.pause(); this.state = 'PAUSED';
    this.suppressInputState = true;
    try { this.midi?.stop(); this.metronome?.pause(); } catch { this.error = 'STEP_MIDI_UNAVAILABLE'; }
    finally { this.suppressInputState = false; }
    this.emit();
  }
  async resume(): Promise<void> {
    if (this.state !== 'PAUSED' || !this.midi) return;
    const generation = ++this.generation; this.error = null;
    try {
      if (this.midi.getState().connectedInputCount === 0) throw new Error('NO_CONNECTED_INPUT');
      await this.midi.start(); if (generation !== this.generation || this.state !== 'PAUSED') return;
      this.runtime?.resume(); this.state = 'ACTIVE'; this.activeAt = this.platform.clock.nowMs();
      this.metronome?.resume(this.runtime!.currentOnsetBeat); this.emit();
    } catch (error) { if (generation === this.generation) { this.error = stepApplicationError(error); this.emit(); } }
  }
  skip(): void {
    if (this.state !== 'ACTIVE') return;
    this.input?.cancel();
    try {
      if (!this.runtime?.skip()) return;
      if (this.runtime.isCompleted) this.complete(); else { this.updateTarget(); this.emit(); }
    } catch (error) { this.failAttempt(error); }
  }
  finish(): void {
    if (this.state === 'ENDED' || this.state === 'DISPOSED') return;
    this.generation++; this.input?.cancel(); this.runtime?.end(); this.complete();
  }
  dispose(): void {
    if (this.state === 'DISPOSED') return;
    this.generation++; this.holdElapsed(); this.input?.cancel(); this.runtime?.end(); this.cleanup();
    this.state = 'DISPOSED'; this.emit(); this.listeners.clear();
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.enabled = enabled; this.runtime?.setMetronomeEnabled(enabled); this.metronome?.setEnabled(enabled);
    if (enabled) this.updateTarget(); this.emit();
  }
  private complete(): void {
    this.holdElapsed(); this.input?.cancel(); this.finalSnapshot = this.runtime?.snapshot() ?? null;
    this.cleanup(); this.state = 'ENDED'; this.emit();
    if (this.finalSnapshot) this.options.onCompletion?.(this.finalSnapshot);
  }
  private updateTarget(): void { if (this.runtime && !this.runtime.isCompleted) this.metronome?.setStepContext(this.runtime.currentOnsetBeat); }
  private holdElapsed(): void {
    if (this.activeAt !== null) this.elapsedMs += this.platform.clock.nowMs() - this.activeAt;
    this.activeAt = null;
  }
  private inputState(state: BrowserMidiState): void {
    if (this.suppressInputState || this.state === 'DISPOSED' || this.state === 'ENDED') return;
    if (state.connectedInputCount > 0) {
      if (this.error === 'NO_CONNECTED_INPUT') { this.error = null; this.emit(); } return;
    }
    if (this.state === 'ACTIVE') this.pause();
    if (this.state === 'PAUSED') { this.error = 'NO_CONNECTED_INPUT'; this.emit(); }
  }
  private failAttempt(error: unknown): void {
    this.pause(); this.input?.cancel(); this.runtime?.cancelAttempt();
    this.error = error instanceof Error && error.message === 'STEP_HISTORY_LIMIT_EXCEEDED' ? 'STEP_HISTORY_LIMIT_EXCEEDED' : 'STEP_ATTEMPT_FAILED';
    if (this.error === 'STEP_HISTORY_LIMIT_EXCEEDED') { this.cleanup(); this.state = 'ENDED'; }
    this.emit();
  }
  private cleanup(): void {
    this.suppressInputState = true;
    const midi = this.midi, metronome = this.metronome; this.midi = null; this.metronome = null;
    this.input?.cancel(); this.input = null;
    try { midi?.dispose(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    try { metronome?.destroy(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    this.suppressInputState = false;
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
