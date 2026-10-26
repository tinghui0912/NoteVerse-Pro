import { StepPracticeRuntime, groupForCurrentStep } from '@/lib/practice/step/domain/runtime';
import { PracticeTimebase, type LocalClock } from '@/lib/practice/kernel/timebase';
import { createLocalSessionId } from '@/lib/practice/kernel/session';
import { type LocalStepSessionSnapshot } from '@/lib/practice/step/domain/session';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';
import { type PracticeInputSource } from '@/lib/practice/kernel/session';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { BrowserMidiState } from '@/lib/practice/midi/browser-midi-controller';
import { browserStepPlatform, type StepMidiPort, type StepMetronomePort, type StepPlatform } from './step-platform';
import { StepMidiAttemptInput } from './step-midi-attempt-input';
import { stepApplicationError, type StepApplicationErrorCode } from './step-errors';
import { MidiStepRetirementPolicy, type StepRetirementPolicy } from './step-retirement-policy';
import { StepMicrophoneInput } from './step-microphone-input';
import type { StepAttemptIdentity } from '@/lib/practice/step/domain/attempt';
import type { StepAcousticAttemptSink } from './step-acoustic-attempt-assembler';

export type StepControllerOptions = Readonly<{
  artifact: PracticeScoreArtifact; scope: PracticeScope; inputSource: PracticeInputSource;
  tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  onCompletion?(snapshot: LocalStepSessionSnapshot): void; platform?: StepPlatform;
}>;
/** Local browser application/resource ownership, not the domain runtime status. */
export type StepControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'ENDED' | 'DISPOSED';

/** The sole STEP application owner. Restart means constructing a fresh owner. */
export class StepPracticeController {
  private readonly platform: StepPlatform;
  private runtime: StepPracticeRuntime | null = null;
  private timebase: PracticeTimebase | null = null;
  private midi: StepMidiPort | null = null;
  private metronome: StepMetronomePort | null = null;
  private input: StepMidiAttemptInput | null = null;
  private microphone: StepMicrophoneInput<StepAttemptIdentity> | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private detachInfrastructure: (() => void) | null = null;
  private readonly abort = new AbortController();
  private preparation: Promise<void> | null = null;
  private cleanupTask: Promise<void> | null = null;
  private completionTask: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private clock: LocalClock;
  private state: StepControllerState = 'IDLE';
  private retirement: StepRetirementPolicy | null = null;
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
    this.clock = this.platform.clock;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot() {
    const session = this.runtime?.snapshot() ?? this.finalSnapshot;
    return Object.freeze({ state: this.state, error: this.error,
      stepInteractionPhase: session?.step.attemptState ?? null,
      canAcceptAttempt: this.state === 'ACTIVE' && this.error === null && (this.runtime?.canAcceptAttempt ?? false),
      pendingPostVerdict: session?.step.pendingPostVerdict ?? null,
      elapsedSeconds: Math.floor((this.elapsedMs + (this.activeAt === null ? 0 : this.clock.nowMs() - this.activeAt)) / 1000),
      activeStepGroup: this.runtime ? groupForCurrentStep(this.runtime) : null,
      sessionSnapshot: session,
      lastSnapshot: this.finalSnapshot, inputDiagnostics: this.input?.snapshot() ?? null,
      microphoneDiagnostics: this.microphone?.snapshot() ?? null });
  }
  start(): Promise<void> {
    if (this.preparation) return this.preparation.then(() => this.cleanupTask ?? undefined);
    if (this.state !== 'IDLE') return Promise.resolve();
    const generation = ++this.generation; this.state = 'PREPARING'; this.error = null; this.emit();
    this.preparation = this.prepare(generation);
    return this.preparation.then(() => this.cleanupTask ?? undefined);
  }
  private async prepare(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const localSessionId = createLocalSessionId('step');
      if (this.options.inputSource === 'MICROPHONE') {
        await this.prepareMicrophone(localSessionId, generation);
        if (generation !== this.generation) return;
      } else {
        const timebase = new PracticeTimebase({ domainId: localSessionId });
        this.timebase = timebase;
        this.retirement = new MidiStepRetirementPolicy(this.platform.clock, timebase);
        const runtime = new StepPracticeRuntime({ ...this.options, clock: this.platform.clock, timebase, localSessionId });
        runtime.setInputUnavailable();
        this.runtime = runtime;
        this.createMetronome();
        this.input = new StepMidiAttemptInput({ ...this.attemptSink(runtime), failure: error => this.failAttempt(error) }, this.platform.timer);
        this.midi = this.platform.createMidi({ timebase, onMidiNote: note => this.input?.note(note), onStateChange: state => this.inputState(state) });
        await this.midi.start();
        if (generation !== this.generation) return;
        if (this.midi.getState().connectedInputCount > 0) {
          runtime.acceptInputAfter(timebase.runtimeToSessionTime(this.platform.clock.nowMs()));
          this.error = null;
        } else this.error = 'NO_CONNECTED_INPUT';
      }
      this.state = 'ACTIVE'; this.activeAt = this.clock.nowMs(); this.updateTarget();
      this.metronome?.start(this.runtime!.currentOnsetBeat); this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = stepApplicationError(error, this.options.inputSource);
      this.state = 'ENDED'; this.runtime?.end();
      await this.cleanup();
      if (generation !== this.generation) return;
      this.runtime = null; this.state = 'IDLE'; this.emit();
    }
  }
  private async prepareMicrophone(localSessionId: string, generation: number): Promise<void> {
    const platform = this.platform.microphone;
    if (!platform) throw new Error('STEP_MICROPHONE_UNAVAILABLE');
    let stream: MediaStream;
    try { stream = await platform.acquireMicrophone(); }
    catch (error) {
      if (stepApplicationError(error, 'MICROPHONE') === 'STEP_MICROPHONE_PERMISSION_DENIED') throw new Error('STEP_MICROPHONE_PERMISSION_DENIED');
      throw new Error('STEP_MICROPHONE_UNAVAILABLE');
    }
    if (generation !== this.generation) { this.stopRoot(stream); return; }
    this.stream = stream;
    const context = platform.createAudioContext(); this.context = context;
    if (context.state !== 'running') await context.resume();
    if (generation !== this.generation) return;
    if (![44100, 48000].includes(context.sampleRate)) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
    this.detachInfrastructure = platform.watchInfrastructure(stream, context, code => this.failAttempt(new Error(code)));
    const microphone = new StepMicrophoneInput<StepAttemptIdentity>(platform, {
      open: time => this.runtime ? this.attemptSink(this.runtime).open(time) : null,
      complete: (identity, evidence) => { if (this.runtime) this.attemptSink(this.runtime).complete(identity, evidence); },
      failure: error => this.failAttempt(error),
    });
    this.microphone = microphone; this.clock = microphone.clock;
    const starting = microphone.start({ context, stream, localSessionId, sourceDomainId: `${localSessionId}:capture` }, this.abort.signal);
    void starting.catch(() => {});
    // start() attaches the shared AudioContext clock before any asynchronous acoustic preparation.
    const runtime = new StepPracticeRuntime({ ...this.options, localSessionId, clock: microphone.clock });
    this.runtime = runtime; runtime.setInputUnavailable(); this.createMetronome(context);
    const boundary = await starting;
    if (generation !== this.generation) return;
    runtime.acceptInputAfter(boundary.sessionTime);
    microphone.arm(boundary);
  }
  private createMetronome(audioContext?: AudioContext): void {
    const scope = resolvePracticeScope(this.options.artifact, this.options.scope);
    this.metronome = this.platform.createMetronome({ artifact: this.options.artifact,
      tempoPlan: resolvePracticeTempoPlan(this.options.artifact, this.options.tempoSelection ?? { mode: 'SCORE' }),
      mode: 'STEP', scopeStartBeat: scope.startBeat, scopeEndBeat: scope.terminalBeat, enabled: this.enabled,
      ...(audioContext ? { audioContext } : {}) });
  }
  private attemptSink(runtime: StepPracticeRuntime): StepAcousticAttemptSink<StepAttemptIdentity> {
    return {
      open: time => {
        if (this.state !== 'ACTIVE' || this.runtime !== runtime) return null;
        const identity = runtime.openAttempt(time);
        if (identity) this.emit();
        return this.state === 'ACTIVE' && runtime.snapshot().step.activeAttempt?.attemptId === identity?.attemptId ? identity : null;
      },
      complete: (identity, evidence) => {
        try {
          if (this.state !== 'ACTIVE' || this.runtime !== runtime || !runtime.analyzeAttempt(identity)) return;
          this.emit();
          const result = runtime.completeAttempt(identity, evidence);
          if (result.kind === 'REJECTED') return;
          this.emit(); this.commitPostVerdict();
        } catch (error) { this.failAttempt(error); }
      },
    };
  }
  skip(): void {
    if (this.state !== 'ACTIVE' || !this.runtime?.canAcceptAttempt) return;
    this.input?.cancel();
    try {
      const boundary = this.microphone?.transitionBoundary();
      if (!this.runtime?.skip(boundary?.sessionTime)) return;
      if (this.runtime.isCompleted) void this.complete();
      else { if (boundary) this.microphone!.arm(boundary); this.updateTarget(); this.emit(); }
    } catch (error) { this.failAttempt(error); }
  }
  async finish(): Promise<void> {
    if (this.state !== 'ENDED' && this.state !== 'DISPOSED') {
      this.generation++; this.input?.cancel(); this.runtime?.end(); void this.complete();
    }
    await this.preparation; await this.cleanupTask; await this.completionTask;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.generation++; this.holdElapsed(); this.input?.cancel(); this.runtime?.end();
    this.state = 'DISPOSED'; const cleanup = this.cleanup(); this.emit(); this.listeners.clear();
    this.disposal = Promise.all([this.preparation, cleanup, this.completionTask]).then(() => {});
    return this.disposal;
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.enabled = enabled; this.runtime?.setMetronomeEnabled(enabled); this.metronome?.setEnabled(enabled);
    if (enabled) this.updateTarget(); this.emit();
  }
  private complete(): Promise<void> {
    if (this.completionTask || this.state === 'ENDED' || this.state === 'DISPOSED') return this.completionTask ?? Promise.resolve();
    this.holdElapsed(); this.input?.cancel(); this.finalSnapshot = this.runtime?.snapshot() ?? null;
    this.state = 'ENDED'; const cleanup = this.cleanup(); this.emit();
    const notify = () => { if (this.finalSnapshot) this.options.onCompletion?.(this.finalSnapshot); };
    if (this.options.inputSource === 'MICROPHONE') this.completionTask = cleanup.then(notify);
    else { notify(); this.completionTask = cleanup; }
    return this.completionTask;
  }
  private updateTarget(): void { if (this.runtime && !this.runtime.isCompleted) this.metronome?.setStepContext(this.runtime.currentOnsetBeat); }
  private commitPostVerdict(): void {
    const step = this.runtime?.snapshot().step;
    if (this.state !== 'ACTIVE' || this.error || !this.runtime || !step?.inputAvailable
      || step.attemptState !== 'POST_VERDICT') return;
    const boundary = this.microphone?.retirementBoundary();
    const watermark = boundary?.sessionTime ?? this.retirement?.retirementWatermark();
    if (!watermark) return;
    const matched = step.pendingPostVerdict?.verdict === 'MATCH';
    this.runtime.rearm(watermark);
    if (boundary) this.microphone!.arm(boundary);
    if (this.runtime.isCompleted) void this.complete();
    else { if (matched) this.updateTarget(); this.emit(); }
  }
  private holdElapsed(): void {
    if (this.activeAt !== null) this.elapsedMs += this.clock.nowMs() - this.activeAt;
    this.activeAt = null;
  }
  private inputState(state: BrowserMidiState): void {
    if (this.suppressInputState || this.state === 'DISPOSED' || this.state === 'ENDED') return;
    if (state.connectedInputCount > 0) {
      if (this.state === 'ACTIVE' && this.error === 'NO_CONNECTED_INPUT' && this.runtime && this.timebase) {
        this.runtime.acceptInputAfter(this.timebase.runtimeToSessionTime(this.platform.clock.nowMs()));
        this.error = null;
        this.commitPostVerdict(); this.emit();
      }
      return;
    }
    if (this.state === 'ACTIVE') {
      this.input?.cancel(); this.runtime?.setInputUnavailable();
      this.error = 'NO_CONNECTED_INPUT'; this.emit();
    }
  }
  private failAttempt(error: unknown): void {
    if (this.state === 'ENDED' || this.state === 'DISPOSED') return;
    this.input?.cancel(); this.runtime?.end(); this.holdElapsed();
    this.error = this.options.inputSource === 'MICROPHONE' ? stepApplicationError(error, 'MICROPHONE', this.state === 'ACTIVE' ? 'ACTIVE' : 'PREPARING')
      : 'STEP_ATTEMPT_FAILED';
    this.generation++; this.state = 'ENDED'; void this.cleanup();
    this.emit();
  }
  private cleanup(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask;
    this.suppressInputState = true;
    try { this.detachInfrastructure?.(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    this.detachInfrastructure = null;
    const microphone = this.microphone, stream = this.stream, context = this.context;
    this.microphone = null; this.stream = null; this.context = null;
    const midi = this.midi, metronome = this.metronome; this.midi = null; this.metronome = null;
    this.input?.cancel(); this.input = null;
    try { midi?.dispose(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    try { metronome?.destroy(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    const disposal = microphone?.dispose(); this.abort.abort();
    this.cleanupTask = (async () => {
      try { await disposal; } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
      if (stream) this.stopRoot(stream);
      try { if (context && context.state !== 'closed') await context.close(); }
      catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
      this.emit();
    })();
    this.suppressInputState = false;
    return this.cleanupTask;
  }
  private stopRoot(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    }
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
