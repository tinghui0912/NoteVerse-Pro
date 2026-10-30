import { MetronomeRuntime } from '@/lib/practice/metronome/metronome-runtime';
import { AcousticFailure, DeviceFailure, isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { resumePracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import type { PracticeAnalysisResourcePlan } from '@/lib/practice/planning/resource-plan';
import type { PracticeRootHealthPort, PracticeRootHealthSnapshot, PracticeDeviceHealth, PracticeDeviceRoots } from '@/lib/practice/device/device-contract';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { StepPracticeRuntime, groupForCurrentStep } from '@/lib/practice/step/domain/runtime';
import { PracticeTimebase } from '@/lib/practice/kernel/timebase';
import { createLocalSessionId } from '@/lib/practice/kernel/session';
import { type LocalStepSessionSnapshot } from '@/lib/practice/step/domain/session';
import type { StepPracticeSessionPlan } from '@/lib/practice/planning/session-plan';
import { browserStepPlatform, type StepMidiPort, type StepPlatform } from './step-platform';
import { StepMidiAttemptInput } from './step-midi-attempt-input';
import { projectStepFailure, type StepApplicationErrorCode } from './step-errors';
import { MidiStepRetirementPolicy, type StepRetirementPolicy } from './step-retirement-policy';
import { StepMicrophoneInput } from './step-microphone-input';
import type { StepAnalysisIntervention } from './step-analysis-intervention';
import type { StepInfrastructureIntervention } from './step-infrastructure-intervention';
import type { StepAttemptIdentity } from '@/lib/practice/step/domain/attempt';
import type { StepAcousticAttemptSink } from './step-acoustic-attempt-assembler';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';

export type StepControllerOptions = Readonly<{
  devices: PracticeDeviceRoots;
  rootHealth: PracticeRootHealthPort;
  startupTimings?: PracticeStartupTimings;
  plan: StepPracticeSessionPlan;
  onNaturalCompletion?(snapshot: LocalStepSessionSnapshot): void; platform?: StepPlatform;
}>;
/** Local browser application/resource ownership, not the domain runtime status. */
export type StepControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'ENDED' | 'DISPOSED';

/** The sole STEP application owner. Restart means constructing a fresh owner. */
export class StepPracticeController {
  private readonly platform: StepPlatform;
  private readonly startup: PracticeStartupTimings;
  private runtime: StepPracticeRuntime | null = null;
  private timebase: PracticeTimebase | null = null;
  private midi: StepMidiPort | null = null;
  private metronome: MetronomeRuntime | null = null;
  private input: StepMidiAttemptInput | null = null;
  private microphone: StepMicrophoneInput<StepAttemptIdentity> | null = null;
  private unboundInference: AcousticInferencePort | null = null;
  private context: AudioContext | null = null;
  private detachRootHealth: (() => void) | null = null;
  private readonly abort = new AbortController();
  private preparation: Promise<void> | null = null;
  private cleanupTask: Promise<void> | null = null;
  private completionTask: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private state: StepControllerState = 'IDLE';
  private retirement: StepRetirementPolicy | null = null;
  private error: StepApplicationErrorCode | null = null;
  private failureCause: unknown = null;
  private analysisIntervention: StepAnalysisIntervention | null = null;
  private infrastructureIntervention: StepInfrastructureIntervention | null = null;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private suppressRootHealth = false;
  private enabled: boolean;
  private finalSnapshot: LocalStepSessionSnapshot | null = null;
  constructor(private readonly options: StepControllerOptions) {
    this.startup = options.startupTimings ?? new PracticeStartupTimings();
    this.platform = options.platform ?? browserStepPlatform(); this.enabled = options.plan.metronomePlan.initiallyEnabled;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  engineeringSnapshot() { return Object.freeze({ startup: this.startup.snapshot(), failureCause: this.failureCause, sessionId: this.snapshot().sessionSnapshot?.localSessionId ?? null }); }
  snapshot() {
    const session = this.runtime?.snapshot() ?? this.finalSnapshot;
    return Object.freeze({ state: this.state, error: this.error, analysisIntervention: this.analysisIntervention,
      infrastructureIntervention: this.infrastructureIntervention,
      stepInteractionPhase: session?.step.attemptState ?? null,
      canAcceptAttempt: this.state === 'ACTIVE' && this.error === null && (this.runtime?.canAcceptAttempt ?? false),
      pendingPostVerdict: session?.step.pendingPostVerdict ?? null,
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
      const resources = this.options.plan.resources;
      if (resources.analysis.kind === 'ACOUSTIC') {
        await this.prepareMicrophone(localSessionId, generation, resources.analysis);
        if (generation !== this.generation) return;
      } else if (resources.input.kind === 'MIDI') {
        const timebase = new PracticeTimebase({ domainId: localSessionId });
        this.timebase = timebase;
        this.retirement = new MidiStepRetirementPolicy(this.platform.clock, timebase);
        const runtime = new StepPracticeRuntime({ ...this.options.plan, metronomeEnabled: this.enabled, clock: this.platform.clock, timebase, localSessionId });
        runtime.setInputUnavailable();
        this.runtime = runtime;
        this.createMetronome();
        this.input = new StepMidiAttemptInput({ ...this.attemptSink(runtime), failure: error => this.failAttempt(error) }, this.platform.timer);
        this.midi = this.platform.createMidi({ access: this.options.devices[resources.input.root]!, timebase, onMidiNote: note => this.input?.note(note) });
        await this.startup.measure('midiBind', () => this.midi!.start());
        if (generation !== this.generation) return;
        if (this.options.rootHealth.snapshot().health[resources.input.root] === 'HEALTHY') {
          runtime.acceptInputAfter(timebase.runtimeToSessionTime(this.platform.clock.nowMs()));
          this.error = null;
        } else this.error = 'NO_CONNECTED_INPUT';
      } else throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
      this.state = 'ACTIVE';
      let subscribed = false;
      this.detachRootHealth = this.options.rootHealth.subscribe(snapshot => { if (subscribed) this.rootHealthChanged(snapshot); });
      subscribed = true; this.rootHealthChanged(this.options.rootHealth.snapshot());
      this.updateTarget();
      this.metronome?.start(this.runtime!.currentOnsetBeat); this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.failureCause = error;
      this.error = isPracticeCausalFailure(error) ? projectStepFailure(error, 'PREPARING')
        : this.options.plan.inputSource === 'MICROPHONE' ? 'STEP_ACOUSTIC_PREPARATION_FAILED' : 'STEP_MIDI_UNAVAILABLE';
      this.state = 'ENDED'; this.runtime?.end();
      await this.cleanup();
      if (generation !== this.generation) return;
      this.runtime = null; this.state = 'IDLE'; this.emit();
    }
  }
  private async prepareMicrophone(localSessionId: string, generation: number, analysis: Extract<PracticeAnalysisResourcePlan, { kind: 'ACOUSTIC' }>): Promise<void> {
    const platform = this.platform.microphone;
    if (!platform) throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
    const inference = await this.startup.measure('acquireInferenceLease', () => platform.acquireInference(this.abort.signal));
    if (generation !== this.generation) { await inference.dispose(); return; }
    this.unboundInference = inference;
    const stream = this.options.devices[analysis.sourceRoot];
    if (!stream || this.options.rootHealth.snapshot().health[analysis.sourceRoot] !== 'HEALTHY') throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
    if (generation !== this.generation) return;
    const context = platform.createAudioContext(); this.context = context;
    await this.startup.measure('audioContextResume', async () => { if (context.state !== 'running') await resumePracticeAudioContext(context); });
    if (generation !== this.generation) return;
    if (![44100, 48000].includes(context.sampleRate)) throw new AcousticFailure('SOURCE_RATE_UNSUPPORTED');
    const microphone = new StepMicrophoneInput<StepAttemptIdentity>({ ...platform, acquireInference: async () => {
      const lease = this.unboundInference;
      if (!lease) throw new Error('PRACTICE_INFERENCE_LEASE_NOT_OWNED');
      this.unboundInference = null; return lease;
    } }, {
      open: time => this.runtime ? this.attemptSink(this.runtime).open(time) : null,
      complete: (identity, evidence) => { if (this.runtime) this.attemptSink(this.runtime).complete(identity, evidence); },
      failure: error => this.failAttempt(error),
    }, this.startup);
    this.microphone = microphone;
    const starting = microphone.start({ context, stream, localSessionId, sourceDomainId: `${localSessionId}:capture` }, this.abort.signal);
    void starting.catch(() => {});
    // start() attaches the shared AudioContext clock before any asynchronous acoustic preparation.
    const runtime = new StepPracticeRuntime({ ...this.options.plan, metronomeEnabled: this.enabled, localSessionId, clock: microphone.clock });
    this.runtime = runtime; runtime.setInputUnavailable(); this.createMetronome(context);
    const boundary = await starting;
    if (generation !== this.generation) return;
    runtime.acceptInputAfter(boundary.sessionTime);
    microphone.arm(boundary);
  }
  private createMetronome(audioContext?: AudioContext): void {
    this.metronome = new MetronomeRuntime(this.options.plan.metronomePlan,
      this.platform.createMetronomeAudio(audioContext ?? null));
    this.metronome.setEnabled(this.enabled);
  }
  private attemptSink(runtime: StepPracticeRuntime): StepAcousticAttemptSink<StepAttemptIdentity> {
    return {
      open: time => {
        if (this.analysisIntervention || this.infrastructureIntervention || this.state !== 'ACTIVE' || this.runtime !== runtime) return null;
        const identity = runtime.openAttempt(time);
        if (identity) this.emit();
        return this.state === 'ACTIVE' && runtime.snapshot().step.activeAttempt?.attemptId === identity?.attemptId ? identity : null;
      },
      complete: (identity, evidence) => {
        try {
          if (this.analysisIntervention || this.infrastructureIntervention || this.state !== 'ACTIVE' || this.runtime !== runtime || !runtime.analyzeAttempt(identity)) return;
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
      if (this.runtime.isCompleted) void this.completeNaturally();
      else { if (boundary) this.microphone!.arm(boundary); this.updateTarget(); this.emit(); }
    } catch (error) { this.failAttempt(error); }
  }
  async abandon(): Promise<void> {
    if (this.runtime?.snapshot().completionReason === 'SCOPE_COMPLETED') {
      await this.completeNaturally(); return;
    }
    await this.dispose();
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    if (this.state === 'DISPOSED') return this.cleanupTask ?? Promise.resolve();
    this.generation++; this.input?.cancel(); this.runtime?.end();
    this.analysisIntervention = null;
    this.infrastructureIntervention = null;
    this.state = 'DISPOSED'; const cleanup = this.cleanup(); this.emit(); this.listeners.clear();
    this.disposal = Promise.all([this.preparation, cleanup, this.completionTask]).then(() => {});
    return this.disposal;
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.enabled = enabled; this.runtime?.setMetronomeEnabled(enabled);
    if (enabled) this.updateTarget();
    this.metronome?.setEnabled(enabled); this.emit();
  }
  private completeNaturally(): Promise<void> {
    if (this.completionTask || this.state === 'ENDED' || this.state === 'DISPOSED') return this.completionTask ?? Promise.resolve();
    const snapshot = this.runtime?.snapshot();
    if (!snapshot || snapshot.completionReason !== 'SCOPE_COMPLETED') throw new Error('STEP completion requires a naturally completed scope.');
    this.input?.cancel(); this.finalSnapshot = snapshot;
    this.state = 'ENDED'; const cleanup = this.cleanup(); this.emit();
    this.completionTask = cleanup.then(() => {
      if (this.state === 'ENDED' && !this.error && this.finalSnapshot?.completionReason === 'SCOPE_COMPLETED') {
        this.options.onNaturalCompletion?.(this.finalSnapshot);
      }
    });
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
    if (this.runtime.isCompleted) { void this.completeNaturally(); return; }
    if (boundary) this.microphone!.arm(boundary);
    if (matched) this.updateTarget();
    this.emit();
  }
  private rootHealthChanged(snapshot: PracticeRootHealthSnapshot): void {
    if (this.state !== 'ACTIVE' || this.suppressRootHealth) return;
    if (this.options.plan.resources.input.kind === 'MIDI') {
      this.midi?.refreshInputs(); this.midiHealthChanged(snapshot.health.midi ?? 'LOST');
    } else this.microphoneHealthChanged(snapshot.health.inputMicrophone ?? 'LOST');
  }
  private midiHealthChanged(health: PracticeDeviceHealth): void {
    if (this.suppressRootHealth || this.state === 'DISPOSED' || this.state === 'ENDED') return;
    if (health === 'HEALTHY') {
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
  private microphoneHealthChanged(health: PracticeDeviceHealth): void {
    if (this.analysisIntervention || this.infrastructureIntervention || this.state !== 'ACTIVE') return;
    if (health === 'LOST') {
      this.failAttempt(new DeviceFailure('SOURCE_LOST', 'MICROPHONE')); return;
    }
    try {
      if (health === 'INTERRUPTED') {
        if (this.error === 'STEP_MICROPHONE_INTERRUPTED') return;
        this.runtime?.setInputUnavailable(); this.microphone?.suspendInput();
        this.error = 'STEP_MICROPHONE_INTERRUPTED'; this.emit();
      } else if (this.error === 'STEP_MICROPHONE_INTERRUPTED' && this.runtime && this.microphone) {
        const boundary = this.microphone.recoveryBoundary();
        this.runtime.acceptInputAfter(boundary.sessionTime);
        this.error = null;
        if (this.runtime.snapshot().step.attemptState === 'POST_VERDICT') this.commitPostVerdict();
        else { this.microphone.arm(boundary); this.emit(); }
      }
    } catch (error) { this.failAttempt(error); }
  }
  private failAttempt(error: unknown): void {
    this.failureCause = error;
    if (this.analysisIntervention || this.infrastructureIntervention || this.state === 'ENDED' || this.state === 'DISPOSED') return;
    const code = this.options.plan.inputSource === 'MICROPHONE'
      ? isPracticeCausalFailure(error) ? projectStepFailure(error, this.state === 'ACTIVE' ? 'ACTIVE' : 'PREPARING')
        : this.state === 'ACTIVE' ? 'STEP_ACOUSTIC_RUNTIME_FAILED' : 'STEP_ACOUSTIC_PREPARATION_FAILED' : 'STEP_ATTEMPT_FAILED';
    if (this.state === 'ACTIVE' && this.runtime && this.options.plan.inputSource === 'MICROPHONE'
      && (code === 'STEP_ACOUSTIC_RUNTIME_FAILED' || code === 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED')) {
      // Latch before domain/cleanup callbacks can reenter. Resource release is not session end.
      if (code === 'STEP_ACOUSTIC_RUNTIME_FAILED') this.analysisIntervention = Object.freeze({ kind: 'TERMINAL_ANALYSIS_FAILURE' });
      else this.infrastructureIntervention = Object.freeze({ kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' });
      this.runtime.setInputUnavailable();
      this.error = null;
      void this.cleanup(); this.emit(); return;
    }
    this.input?.cancel(); this.runtime?.end(); this.error = code;
    this.generation++; this.state = 'ENDED'; void this.cleanup(); this.emit();
  }
  private cleanup(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask;
    this.suppressRootHealth = true;
    try { this.detachRootHealth?.(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    this.detachRootHealth = null;
    const microphone = this.microphone, context = this.context;
    this.microphone = null; this.context = null;
    const midi = this.midi, metronome = this.metronome; this.midi = null; this.metronome = null;
    this.input?.cancel(); this.input = null;
    try { midi?.dispose(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    try { metronome?.dispose(); } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    let disposal: Promise<void> | undefined;
    try { disposal = microphone?.dispose() ?? this.unboundInference?.dispose(); }
    catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
    this.unboundInference = null; this.abort.abort();
    this.cleanupTask = (async () => {
      try { await disposal; } catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
      try { if (context && context.state !== 'closed') await context.close(); }
      catch { this.error = 'STEP_RESOURCE_CLEANUP_FAILED'; }
      this.emit();
    })();
    this.suppressRootHealth = false;
    return this.cleanupTask;
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
