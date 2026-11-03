import { releaseRecordingMedia } from '@/lib/practice/recording/recording-media-resource';
import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import { MetronomeRuntime } from '@/lib/practice/metronome/metronome-runtime';
import { DeviceFailure, MidiFailure, isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { resumePracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import type { PracticeRootHealthPort, PracticeRootHealthSnapshot } from '@/lib/practice/device/device-contract';
import type { PracticeDeviceRoots } from '@/lib/practice/device/device-contract';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { ContinuousMicrophoneHealth, type MicrophoneResourceHealth } from './microphone-resource-health';
import type { ContinuousPracticeCompletion } from './completion';
import { createNaturalContinuousCompletion } from './natural-completion';
import { midiEvidenceProvenance, microphoneEvidenceProvenance, type ContinuousEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import { qualifiedAcousticSourceRate } from '@/lib/practice/acoustic/failure-boundary';
import type { ContinuousTargetFeedback } from '@/lib/practice/continuous/domain/evaluation/target-feedback';
import { type PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { type LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { createLocalSessionId } from '@/lib/practice/kernel/session';
import type { ContinuousPracticeSessionPlan } from '@/lib/practice/planning/session-plan';
import { RecordingFailure } from '@/lib/practice/failure/causal-failure';
import type { ContinuousAnalysisIntervention } from './analysis-intervention';
import type { PracticeResourceIntervention } from './resource-intervention';
import { AudioContextPerformanceClock } from './audio-context-performance-clock';
import { projectContinuousFailure, ContinuousApplicationFailure, type ContinuousErrorCode } from './continuous-errors';
import type { ContinuousPlatform, ContinuousRecorderPort } from './continuous-input';
import { ContinuousMicrophoneInput } from './continuous-microphone-input';
import { ContinuousMidiInput } from './continuous-midi-input';
import { browserContinuousPlatform } from './continuous-platform';

import { continuousMetronomeSyncPoint } from './metronome-sync';

const DIAGNOSTIC_LIMIT = 32;

export type ContinuousControllerOptions = Readonly<{
  devices: PracticeDeviceRoots;
  rootHealth: PracticeRootHealthPort;
  startupTimings?: PracticeStartupTimings;
  plan: ContinuousPracticeSessionPlan;
  countInBeats?: number;
  onNaturalCompletion?(snapshot: LocalPerformanceSessionSnapshot): void;
}>;
export type ContinuousControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'FINALIZING' | 'COMPLETE' | 'FAILED_BEFORE_START' | 'FAILED' | 'ABANDONED' | 'DISPOSED';
export type ContinuousControllerSnapshot = Readonly<{
  session: ContinuousControllerState; transport: PerformanceClockSnapshot | null;
  analysis: 'NOT_REQUIRED' | 'PREPARING' | 'PREROLL' | 'RUNNING' | 'PAUSED' | 'DRAINING' | 'COMPLETE' | 'INTERRUPTED' | 'DISABLED' | 'FAILED';
  analysisError: ContinuousErrorCode | null; inputError: ContinuousErrorCode | null; recording: ReturnType<ContinuousRecorderPort['snapshot']> | null;
  analysisIntervention: ContinuousAnalysisIntervention | null;
  resourceIntervention: PracticeResourceIntervention | null;
  evaluation: ContinuousTargetFeedback | null; completed: ContinuousPracticeCompletion | null;
  sessionSnapshot: LocalPerformanceSessionSnapshot | null;
}>;

/** Application lifecycle owner. Inputs cannot control this transport or completion. */
export class ContinuousPracticeController {
  private state: ContinuousControllerState = 'IDLE';
  private session: ContinuousPracticeSession | null = null;
  private transport: PerformanceClockSnapshot | null = null;
  private microphone: ContinuousMicrophoneInput | null = null;
  private midi: ContinuousMidiInput | null = null;
  private recorder: ContinuousRecorderPort | null = null;
  private metronome: MetronomeRuntime | null = null;
  private context: AudioContext | null = null;
  private rootStream: MediaStream | null = null;
  private renderClock: AudioContextPerformanceClock | null = null;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private futureBegin: string | null = null;
  private futureTerminal: string | null = null;
  private inputError: ContinuousErrorCode | null = null;
  private analysisError: ContinuousErrorCode | null = null;
  private analysisIntervention: ContinuousAnalysisIntervention | null = null;
  private analysisDisabled = false;
  private microphoneRelease: Promise<void> | null = null;
  private completed: ContinuousPracticeCompletion | null = null;
  private disposal: Promise<void> | null = null;
  private evidenceProvenance: ContinuousEvidenceProvenance | null = null;
  private finalSession: LocalPerformanceSessionSnapshot | null = null;
  private completion: Promise<void> | null = null;
  private abandonment: Promise<void> | null = null;
  private preparing: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private cleanupFailure: 'RESOURCE_CLEANUP_FAILED' | null = null;
  private fatalFailure: ContinuousErrorCode | null = null;
  private inputResources: ContinuousMicrophoneHealth | null = null;
  private inputIncident: MicrophoneResourceHealth | null = null;
  private updatingIntervention = false;
  private disposed = false;
  private recordingBegan = false;
  private resumeRecordingAt: number | null = null;
  private intervention: PracticeResourceIntervention | null = null;
  private detachRootHealth: (() => void) | null = null;
  private detachRecorder: (() => void) | null = null;
  private transitioning = false;
  private pendingTransportPause = false;
  private pendingResourceIntervention = false;
  private drainingTransitions = false;
  private enabled: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly diagnostics: Readonly<{ action: string; state: string; performanceTimeMs: number; detail?: string }>[] = [];
  private readonly startup: PracticeStartupTimings;
  constructor(private readonly options: ContinuousControllerOptions, private readonly platform: ContinuousPlatform = browserContinuousPlatform()) {
    this.startup = options.startupTimings ?? new PracticeStartupTimings();
    this.enabled = options.plan.metronomePlan.initiallyEnabled;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): ContinuousControllerSnapshot {
    const runtimeState = this.microphone?.snapshot().runtime?.state;
    const analysis = this.options.plan.resources.analysis.kind === 'NONE' ? 'NOT_REQUIRED' : this.fatalFailure || this.state === 'FAILED' ? 'FAILED' : this.analysisIntervention ? 'INTERRUPTED' : this.analysisDisabled ? 'DISABLED' : this.analysisError ? 'FAILED'
      : this.state === 'PREPARING' ? runtimeState === 'PREROLL' ? 'PREROLL' : 'PREPARING'
      : this.state === 'COMPLETE' ? 'COMPLETE' : this.state === 'FINALIZING' ? 'DRAINING'
      : this.transport?.state === 'PAUSED' ? 'PAUSED' : this.transport?.state === 'RUNNING' ? 'RUNNING' : 'PREROLL';
    return Object.freeze({ session: this.state, transport: this.transport ? Object.freeze({ ...this.transport }) : null,
      analysis, analysisError: this.analysisError, inputError: this.inputError, recording: this.fatalFailure ? null : this.recorder?.snapshot(this.transport?.performanceTimeMs ?? 0) ?? null,
      analysisIntervention: this.analysisIntervention, resourceIntervention: this.intervention,
      evaluation: this.analysisError || this.fatalFailure || ['FAILED_BEFORE_START', 'ABANDONED', 'DISPOSED'].includes(this.state) ? null : this.session?.targetFeedback ?? null, completed: this.state === 'COMPLETE' ? this.completed : null,
      sessionSnapshot: this.state === 'COMPLETE' ? this.finalSession : null });
  }
  engineeringSnapshot() { return Object.freeze({ startup: this.startup.snapshot(), sessionId: this.session?.timebase.domainId ?? null, microphone: this.microphone?.snapshot() ?? null,
    diagnostics: Object.freeze([...this.diagnostics]), diagnosticLimit: DIAGNOSTIC_LIMIT,
    diagnosticPlanningBytes: DIAGNOSTIC_LIMIT * 1024, physicalRootHealth: this.options.rootHealth.snapshot(),
    audioContextState: this.context?.state ?? 'CLOSED', audioContextRate: this.context?.sampleRate ?? null }); }
  start(): Promise<void> {
    if (this.preparing) return this.preparing;
    if (this.state !== 'IDLE' || this.disposed) return Promise.reject(new Error('CONTINUOUS_SESSION_NOT_IDLE'));
    this.state = 'PREPARING'; this.notify();
    this.preparing = this.prepareAndStart(); return this.preparing;
  }
  private async prepareAndStart(): Promise<void> {
    try {
      const resources = this.options.plan.resources;
      if (resources.analysis.kind === 'ACOUSTIC') {
        this.microphone = new ContinuousMicrophoneInput(this.platform, reason => this.analysisFailed(reason), this.startup);
        await this.startup.measure('acquireInferenceLease', () => this.microphone!.acquire(this.abort.signal)); this.checkAlive();
        this.rootStream = this.options.devices[resources.analysis.sourceRoot];
        if (!this.rootStream || this.options.rootHealth.snapshot().health[resources.analysis.sourceRoot] !== 'HEALTHY') throw new DeviceFailure('SOURCE_LOST', 'MICROPHONE');
        this.checkAlive();
        this.context = this.platform.createAudioContext(); await this.startup.measure('audioContextResume', () => resumePracticeAudioContext(this.context!)); this.checkAlive();
        this.inputResources = new ContinuousMicrophoneHealth(this.options.rootHealth.snapshot().health[resources.analysis.sourceRoot] ?? 'LOST', this.context, health => this.inputHealthChanged(health));
        this.checkAlive();
        this.renderClock = new AudioContextPerformanceClock(this.context);
        this.evidenceProvenance = microphoneEvidenceProvenance(qualifiedAcousticSourceRate(this.context.sampleRate));
      }
      this.session = new ContinuousPracticeSession({
        ...(this.options.plan.inputSource === 'MIDI'
          ? { inputSource: 'MIDI' as const, createClockEvidence: (domainId: string) => {
              const evidence = new ContinuousMidiEvidence(domainId);
              this.evidenceProvenance = midiEvidenceProvenance(evidence.evidencePolicyId); return evidence;
            } }
          : { inputSource: 'MICROPHONE' as const }), artifact: this.options.plan.artifact, scope: this.options.plan.scope,
        sourceId: this.options.plan.sourceId, tempoPlan: this.options.plan.tempoPlan, clock: this.renderClock ?? this.platform.midiClock,
        localSessionId: createLocalSessionId(), countInBeats: this.options.countInBeats, metronomeEnabled: this.enabled });
      const session = this.session;
      if (this.microphone) {
        await this.microphone.connect({ context: this.context!, stream: this.rootStream!, sessionDomainId: session.timebase.domainId,
          clock: this.renderClock!, publish: publication => { if (this.analysisError || this.disposed || this.state === 'ABANDONED') return; this.checkAlive(); session.publishAnalysis(publication); this.notify(); } }, this.abort.signal);
      } else if (resources.input.kind === 'MIDI') {
        this.midi = new ContinuousMidiInput(this.platform, { access: this.options.devices[resources.input.root]!, timebase: session.timebase,
          observe: attack => { session.observeMidiAttack(attack); this.notify(); } });
        await this.startup.measure('midiBind', () => this.midi!.prepare());
      } else throw new DeviceFailure('SOURCE_LOST', 'MICROPHONE');
      this.checkAlive();
      try {
        const recording = resources.recording;
        this.recorder = this.platform.createRecorder(recording.mode);
        await this.startup.measure('recorderAdmission', () => this.recorder!.prepare({
          audioRoot: recording.mode === 'OFF' ? null : this.options.devices[recording.audioRoot],
          cameraStream: recording.mode === 'VIDEO' ? this.options.devices[recording.videoRoot] : null }));
      } catch (error) { throw error instanceof RecordingFailure ? error : new ContinuousApplicationFailure('RECORDING_PREPARATION_FAILED', { cause: error }); }
      this.detachRecorder = this.recorder.onRuntimeFault(() => this.updateResourceIntervention());
      let subscribed = false;
      this.detachRootHealth = this.options.rootHealth.subscribe(snapshot => { if (subscribed) this.rootHealthChanged(snapshot); });
      subscribed = true; this.rootHealthChanged(this.options.rootHealth.snapshot());
      this.checkAlive();
      this.metronome = new MetronomeRuntime(this.options.plan.metronomePlan,
        this.platform.createMetronomeAudio(this.context));
      this.metronome.setEnabled(this.enabled);
      this.transition(C => {
        this.assertMidiSourceHealthy();
        try { this.recorder!.assertPrepared(); } catch (error) { throw error instanceof RecordingFailure ? error : new ContinuousApplicationFailure('RECORDING_PREPARATION_FAILED', { cause: error }); }
        this.microphone?.assertBoundary(C);
        this.recorder!.activate(); this.transport = session.start(); this.state = 'ACTIVE';
        this.planRunning(C); this.metronome!.start(continuousMetronomeSyncPoint(this.transport));
        if (this.transport.state === 'RUNNING') this.startRecording();
      });
      this.state = 'ACTIVE'; this.record('START'); this.timer = setInterval(() => this.refresh(), 10); this.notify();
    } catch (error) {
      if (!this.disposed && this.state !== 'ABANDONED' && !this.fatalFailure) { this.inputError = error instanceof ContinuousApplicationFailure ? error.code : error instanceof RecordingFailure
        ? 'RECORDING_PREPARATION_FAILED' : isPracticeCausalFailure(error) ? projectContinuousFailure(error, 'PREPARING')
          : this.options.plan.inputSource === 'MICROPHONE' ? 'MODEL_LOAD_FAILED' : 'MIDI_UNAVAILABLE';
        this.record('PREPARATION_FAILED', String(error));
        if (this.options.plan.inputSource === 'MICROPHONE' && this.inputError !== 'RECORDING_PREPARATION_FAILED') this.analysisError ??= this.inputError;
        this.state = 'FAILED_BEFORE_START'; }
      await this.cleanup(); if (this.cleanupFailure && !this.disposed) this.state = 'FAILED'; this.notify();
    }
  }
  pause(): void {
    if (this.intervention) this.intervention = Object.freeze({ ...this.intervention, pauseOrigin: 'USER' });
    if (this.analysisIntervention) this.analysisIntervention = Object.freeze({ pauseOrigin: 'USER' });
    this.pauseTransport();
  }
  private pauseTransport(): void {
    if (this.state !== 'ACTIVE') return;
    if (this.transitioning) { this.pendingTransportPause = true; return; }
    this.refresh(); if (this.transport?.state === 'ENDED' || this.transport?.state === 'PAUSED') return;
    this.transition(C => {
      const before = this.session!.snapshot();
      if (before.state === 'ENDED') { this.transport = before; return; }
      this.cancelFuture(before.state === 'COUNT_IN');
      this.transport = this.session!.pause();
      if (!this.analysisError && (before.state === 'RUNNING' || before.countInKind === 'INITIAL' && this.microphone?.hasRunningSegment) && this.context?.state !== 'closed' && !this.microphone?.snapshot().capture?.failed) this.boundary('PAUSE', C, this.transport.performanceTimeMs);
      if (this.recordingBegan) this.recorder?.pause(this.transport.performanceTimeMs);
      this.metronome?.pause();
    }); this.record('PAUSE'); this.notify();
  }
  resume(): void {
    if (this.analysisIntervention || this.intervention || this.inputResources && !this.inputResources.snapshot().healthy || this.state !== 'ACTIVE' || this.transport?.state !== 'PAUSED') return;
    try { this.assertMidiSourceHealthy(); } catch (error) { this.inputError = isPracticeCausalFailure(error) ? projectContinuousFailure(error, 'ACTIVE') : 'MIDI_UNAVAILABLE'; this.notify(); return; }
    this.inputError = null;
    this.transition(C => {
      const T = this.transport!.performanceTimeMs; this.transport = this.session!.resume();
      if (this.transport.performanceTimeMs !== T) throw new Error('CONTINUOUS_RESUME_IDENTITY_VIOLATION');
      this.planRunning(C); this.metronome?.resume(continuousMetronomeSyncPoint(this.transport));
      this.resumeRecordingAt = this.recordingBegan ? T : null;
      if (this.transport.state === 'RUNNING') {
        if (this.recordingBegan) this.recorder?.resume(T); else this.startRecording();
        this.resumeRecordingAt = null;
      }
    }); this.record('RESUME'); this.notify();
  }
  abandon(): Promise<void> {
    if (this.completion) return this.completion;
    if (this.abandonment) return this.abandonment;
    // Inspect the latched reason only. Advancing the domain here would turn an End
    // received before the terminal transition into a natural completion.
    if (this.session?.clock.terminationReason === 'SCOPE_COMPLETED') {
      this.refresh(); return this.completion ?? Promise.resolve();
    }
    if (this.disposed || !['ACTIVE', 'PREPARING'].includes(this.state)) return Promise.resolve();
    this.state = 'ABANDONED';
    this.analysisIntervention = null; this.intervention = null;
    try {
      this.cancelFuture(true);
      this.transition(() => { if (this.session) this.transport = this.session.abandon(); });
    } finally {
      this.abort.abort(); this.record('ABANDON'); this.notify();
      this.abandonment = (async () => {
        await this.cleanup(); await this.preparing;
        this.session = null; this.transport = null; this.recorder = null; this.microphone = null; this.midi = null;
        this.metronome = null; this.context = null; this.renderClock = null; this.evidenceProvenance = null;
        this.completed = null; this.finalSession = null;
        if (this.cleanupFailure) this.state = 'FAILED';
        this.notify();
      })();
    }
    return this.abandonment;
  }
  /** Application heartbeat explicitly catches up semantic deadlines, then samples presentation. */
  refresh(): void {
    if (this.state !== 'ACTIVE' || !this.session) return;
    this.transport = this.session.advanceToNow();
    if (this.transport.state === 'RUNNING') {
      if (!this.recordingBegan) this.startRecording();
      else if (this.resumeRecordingAt !== null) { const T = this.resumeRecordingAt; this.resumeRecordingAt = null; this.recorder?.resume(T); }
    }
    if (this.transport.completionReason === 'SCOPE_COMPLETED') {
      try { void this.completeNaturally(this.recorder?.freeze(this.transport.performanceTimeMs) ?? Promise.resolve()); }
      catch (error) { void this.failSession('RECORDER_UNAVAILABLE', error); } return;
    }
    this.notify();
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.enabled = enabled; this.session?.setMetronomeEnabled(enabled);
    if (enabled && this.transport) this.metronome?.syncContinuous(continuousMetronomeSyncPoint(this.transport));
    this.metronome?.setEnabled(enabled);
  }
  private startRecording(): void { this.recorder?.startIfReady(0); this.recordingBegan = true; }
  private planRunning(C: number): void {
    if (!this.microphone || this.analysisError) return;
    const clock = this.transport!, beginC = C + clock.countInRemainingMs / 1000;
    this.futureBegin = this.boundary('BEGIN', beginC, clock.performanceTimeMs);
    this.futureTerminal = this.boundary('TERMINAL', beginC + (this.session!.clock.scopeDurationMs() - clock.performanceTimeMs) / 1000,
      this.session!.clock.scopeDurationMs());
  }
  private cancelFuture(cancelBegin: boolean): void {
    // A logically reached BEGIN may still await its PCM message. Preserve it so
    // an immediate Pause/Stop closes that segment rather than erasing its start.
    if (cancelBegin) this.microphone?.cancelPending(this.futureBegin);
    this.microphone?.cancelPending(this.futureTerminal); this.futureBegin = null; this.futureTerminal = null;
  }
  private boundary(type: 'BEGIN' | 'PAUSE' | 'TERMINAL', C: number, T: number): string | null {
    if (!this.microphone || this.analysisError) return null;
    try { return this.microphone.boundary(type, C, T); }
    catch (error) { this.microphone.fail(error instanceof Error ? error : new Error('Unexpected microphone boundary failure', { cause: error })); this.analysisFailed(error);
      if (this.state === 'PREPARING') throw error; return null; }
  }
  private transition(action: (C: number) => void): void {
    this.transitioning = true;
    try { if (this.renderClock) this.renderClock.transaction(action); else action(0); }
    finally { this.transitioning = false; this.drainPendingTransitions(); }
  }
  /** Clock ownership is released before synchronous callbacks can act on transport. */
  private drainPendingTransitions(): void {
    if (this.transitioning || this.drainingTransitions) return;
    this.drainingTransitions = true;
    try {
      while (this.pendingTransportPause || this.pendingResourceIntervention) {
        const pause = this.pendingTransportPause, resources = this.pendingResourceIntervention;
        this.pendingTransportPause = false; this.pendingResourceIntervention = false;
        if (pause) this.pauseTransport();
        if (resources) this.applyResourceIntervention();
      }
    } finally { this.drainingTransitions = false; }
  }
  private assertMidiSourceHealthy(): void {
    const input = this.options.plan.resources.input;
    if (input.kind === 'MIDI' && this.options.rootHealth.snapshot().health[input.root] !== 'HEALTHY') throw new MidiFailure('NO_CONNECTED_INPUT');
  }
  private rootHealthChanged(snapshot: PracticeRootHealthSnapshot): void {
    if (this.disposed || !['PREPARING', 'ACTIVE', 'FINALIZING'].includes(this.state)
      || this.state !== 'FINALIZING' && this.session?.clock.terminationReason === 'SCOPE_COMPLETED') return;
    const resources = this.options.plan.resources;
    if (resources.analysis.kind === 'ACOUSTIC') this.inputResources?.observeSourceHealth(snapshot.health[resources.analysis.sourceRoot] ?? 'LOST');
    if (resources.input.kind === 'MIDI') {
      this.midi?.refreshInputs();
      if (snapshot.health[resources.input.root] !== 'HEALTHY') {
        this.inputError = 'NO_CONNECTED_INPUT';
      } else if (this.inputError === 'NO_CONNECTED_INPUT') this.inputError = null;
    }
    const recording = resources.recording;
    if (recording.mode !== 'OFF') {
      this.recorder?.observeSourceHealth({ audio: snapshot.health[recording.audioRoot] ?? 'LOST',
        ...(recording.mode === 'VIDEO' ? { video: snapshot.health[recording.videoRoot] ?? 'LOST' } : {}) });
    }
    this.updateResourceIntervention(); this.notify();
  }
  private inputHealthChanged(health: MicrophoneResourceHealth): void {
    if (this.disposed) return;
    if (this.state === 'FINALIZING' && !health.healthy) { void this.failSession(health.reason === 'CAPTURE_PIPELINE_INVALID' ? 'ANALYSIS_FAILED' : health.reason); return; }
    if (this.session?.clock.terminationReason === 'SCOPE_COMPLETED' || !['ACTIVE', 'PREPARING'].includes(this.state)) return;
    if (this.state === 'PREPARING') { if (!health.healthy) void this.failSession(health.reason === 'CAPTURE_PIPELINE_INVALID' ? 'ANALYSIS_FAILED' : health.reason); return; }
    if (!health.healthy || this.inputIncident) this.inputIncident = this.inputIncident?.recoverability === 'RESTART_REQUIRED'
      ? Object.freeze({ ...this.inputIncident, healthy: false })
      : health.healthy && this.inputIncident ? Object.freeze({ ...health, reason: this.inputIncident.reason }) : health;
    this.updateResourceIntervention();
  }
  private updateResourceIntervention(): void {
    // An in-progress resource action rereads the latched facts after pausing.
    if (this.updatingIntervention) return;
    this.pendingResourceIntervention = true; this.drainPendingTransitions();
  }
  private applyResourceIntervention(): void {
    if (this.updatingIntervention || this.disposed || this.state !== 'ACTIVE' || this.session?.clock.terminationReason === 'SCOPE_COMPLETED') return;
    const liveInput = this.inputResources?.snapshot();
    if (liveInput && !liveInput.healthy && this.inputIncident?.recoverability !== 'RESTART_REQUIRED') this.inputIncident = liveInput;
    const recording = this.recorder?.runtimeFault();
    let input = this.inputIncident;
    const midiIncident = this.inputError === 'NO_CONNECTED_INPUT' || this.intervention?.reason === 'NO_CONNECTED_INPUT';
    if (!input && !recording && !midiIncident) return;
    this.updatingIntervention = true;
    try {
      const pauseOrigin = this.intervention?.pauseOrigin ?? this.analysisIntervention?.pauseOrigin ?? (this.transport?.state === 'PAUSED' ? 'USER' : 'INTERVENTION');
      this.pauseTransport();
      input = this.inputIncident;
      if (this.state !== 'ACTIVE' || this.transport?.state !== 'PAUSED') return;
      const currentRecording = this.recorder?.runtimeFault();
      const inputRequired = Boolean(input || midiIncident);
      const hard = input?.recoverability === 'RESTART_REQUIRED' || currentRecording?.recoverability === 'RESTART_REQUIRED';
      const recovered = !hard && (!input || input.healthy) && this.inputError !== 'NO_CONNECTED_INPUT'
        && (!currentRecording || currentRecording.state === 'RECOVERED_WAITING_FOR_USER');
      this.intervention = Object.freeze({ impact: inputRequired ? (this.options.plan.resources.recording.mode !== 'OFF' ? 'INPUT_AND_RECORDING' : 'INPUT_REQUIRED') : 'RECORDING_ONLY',
        reason: input?.reason ?? (midiIncident ? 'NO_CONNECTED_INPUT' : currentRecording!.reason),
        recoverability: hard ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE',
        state: recovered ? 'RECOVERED_WAITING_FOR_USER' : 'WAITING_FOR_USER', pauseOrigin });
      this.record('RESOURCE_INTERVENTION', this.intervention.impact); this.notify();
    } finally { this.updatingIntervention = false; }
  }
  async continueWithoutRecording(): Promise<void> {
    if (this.analysisIntervention || this.intervention?.impact !== 'RECORDING_ONLY' || this.intervention.state !== 'WAITING_FOR_USER' || this.state !== 'ACTIVE'
      || this.inputResources && !this.inputResources.snapshot().healthy || this.inputError === 'NO_CONNECTED_INPUT') return;
    try { this.assertMidiSourceHealthy(); } catch { this.inputError = 'NO_CONNECTED_INPUT'; this.updateResourceIntervention(); return; }
    const resume = this.intervention.pauseOrigin === 'INTERVENTION';
    const current = this.intervention;
    try { await this.recorder!.continueWithoutRecording(); }
    catch (error) { await this.failSession('RESOURCE_CLEANUP_FAILED', error); return; }
    if (this.disposed || this.state !== 'ACTIVE' || this.intervention !== current) return;
    this.intervention = null;
    this.record('RECORDING_LOSS_ACCEPTED'); if (resume) this.resume(); this.notify();
  }
  continueAfterRecovery(): boolean {
    if (this.analysisIntervention || this.intervention?.state !== 'RECOVERED_WAITING_FOR_USER' || this.state !== 'ACTIVE'
      || this.inputResources && !this.inputResources.snapshot().healthy || this.inputError === 'NO_CONNECTED_INPUT') return false;
    if (this.recorder?.runtimeFault() && !this.recorder.recoverRuntime()) return false;
    const resume = this.intervention.pauseOrigin === 'INTERVENTION'; this.inputIncident = null; this.intervention = null;
    if (resume) this.resume(); this.notify(); return this.intervention === null;
  }
  private completeNaturally(mediaStop: Promise<unknown>): Promise<void> {
    if (this.completion) return this.completion;
    if (this.session?.clock.terminationReason !== 'SCOPE_COMPLETED') throw new Error('Continuous completion requires a naturally completed scope.');
    this.analysisIntervention = null; this.intervention = null;
    this.state = 'FINALIZING'; if (this.timer) clearInterval(this.timer); this.timer = null; this.metronome?.stop(); this.notify();
    // Observe unexpected stop rejection immediately, even while acoustic tail work is pending.
    const stopped = mediaStop.catch(error => this.failSession('RECORDER_UNAVAILABLE', error));
    this.completion = (async () => {
      let finalizedRecording: PerformanceRecording | null = null;
      try {
        if (this.microphone && !this.analysisError) {
          try { await this.microphone.finish(this.abort.signal); }
          catch (error) { if (this.disposed) return; this.analysisFailed(error); }
        }
        await stopped; this.checkAlive();
        // After admission and Start, media degradation is independent of evaluation and completion.
        const recording = await this.recorder!.finalize(); finalizedRecording = recording; this.checkAlive();
        const session = this.session!; this.finalSession = session.snapshotSession();
        const evaluation = this.analysisError ? unavailableContinuousEvaluation(this.options.plan.inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE')
          : session.completedEvaluation();
        if (!this.evidenceProvenance) throw new Error('CONTINUOUS_EVIDENCE_IDENTITY_UNAVAILABLE');
        this.completed = createNaturalContinuousCompletion({ session: this.finalSession,
          artifact: this.options.plan.artifact,
          evaluation, evidenceProvenance: this.evidenceProvenance, recording, completedAt: new Date().toISOString() });
        finalizedRecording = null;
        await this.cleanup(); this.checkAlive();
        this.state = 'COMPLETE'; this.record('COMPLETE');
        this.notify(); this.options.onNaturalCompletion?.(this.finalSession);
      } catch (error) {
        if (finalizedRecording?.status === 'READY') await releaseRecordingMedia(finalizedRecording.resource);
        if (!this.disposed) await this.failSession(this.cleanupFailure ? 'RESOURCE_CLEANUP_FAILED' : isPracticeCausalFailure(error) ? projectContinuousFailure(error, 'ACTIVE') : 'RECORDER_UNAVAILABLE', error);
      } finally { if (this.disposed) await this.cleanup(); }
    })();
    return this.completion;
  }
  private analysisFailed(reason: unknown): void {
    if (this.analysisError || this.fatalFailure || this.disposed || !['PREPARING', 'ACTIVE', 'FINALIZING'].includes(this.state)) return;
    if (this.state === 'ACTIVE' && this.microphone?.snapshot().capture?.failed) {
      this.inputHealthChanged({ healthy: false, reason: 'CAPTURE_PIPELINE_INVALID', recoverability: 'RESTART_REQUIRED' }); return;
    }
    this.analysisError = isPracticeCausalFailure(reason) ? projectContinuousFailure(reason, this.state === 'PREPARING' ? 'PREPARING' : 'ACTIVE') : 'ANALYSIS_FAILED';
    if (this.state === 'ACTIVE') {
      this.analysisIntervention = Object.freeze({ pauseOrigin: this.intervention?.pauseOrigin
        ?? (this.transport?.state === 'PAUSED' ? 'USER' : 'INTERVENTION') });
      // Failed analysis cannot acknowledge a PAUSE boundary. Only canonical transport/media pause.
      this.pauseTransport();
      if (this.state !== 'ACTIVE') this.analysisIntervention = null;
    }
    if (this.state !== 'PREPARING') {
      this.futureBegin = null; this.futureTerminal = null;
      if (this.inputIncident?.reason === 'MICROPHONE_SOURCE_LOST') { this.inputIncident = null; this.intervention = null; }
      this.inputResources?.releaseAnalysisSource();
      void this.releaseMicrophone().catch(error => this.failSession('RESOURCE_CLEANUP_FAILED', error));
    }
    this.record('ANALYSIS_FAILED', String(reason)); this.notify();
  }
  async continueWithoutAnalysis(): Promise<void> {
    const intervention = this.analysisIntervention;
    if (!intervention || this.state !== 'ACTIVE') return;
    try { await this.releaseMicrophone(); }
    catch (error) { await this.failSession('RESOURCE_CLEANUP_FAILED', error); return; }
    if (this.disposed || this.state !== 'ACTIVE' || this.analysisIntervention !== intervention) return;
    this.analysisDisabled = true; this.analysisIntervention = null;
    this.record('ANALYSIS_DISABLED');
    this.updateResourceIntervention();
    if (intervention.pauseOrigin === 'INTERVENTION' && !this.intervention) this.resume();
    this.notify();
  }
  private releaseMicrophone(): Promise<void> {
    if (!this.microphoneRelease) {
      try { this.microphoneRelease = this.microphone?.dispose() ?? Promise.resolve(); }
      catch (error) { this.microphoneRelease = Promise.reject(error); }
    }
    return this.microphoneRelease;
  }
  private async failSession(code: ContinuousErrorCode, cause: unknown = code): Promise<void> {
    if (this.disposed || this.fatalFailure || ['COMPLETE', 'ABANDONED'].includes(this.state)) return;
    this.fatalFailure = code; this.inputError = code; this.analysisError = code;
    await this.releaseCompletedRecording(); this.finalSession = null; this.state = 'FAILED';
    this.abort.abort(); this.microphone?.fail(new Error(code, { cause })); this.record('SESSION_FAILED', String(cause)); this.notify();
    await this.cleanup(); this.notify();
  }
  private checkAlive(): void {
    if (this.disposed || this.state === 'ABANDONED' || this.abort.signal.aborted) throw new Error('CONTINUOUS_DISPOSED');
    if (this.fatalFailure || this.cleanupFailure) throw new ContinuousApplicationFailure(this.fatalFailure ?? this.cleanupFailure!);
    if (this.state === 'PREPARING' && this.analysisError) throw new ContinuousApplicationFailure(this.analysisError);
  }
  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.inputResources?.dispose(); this.inputResources = null; this.inputIncident = null;
    this.detachRootHealth?.(); this.detachRootHealth = null; this.detachRecorder?.(); this.detachRecorder = null; this.analysisIntervention = null; this.intervention = null; this.pendingTransportPause = false; this.pendingResourceIntervention = false;
    this.cleanupPromise = (async () => {
      const failed = (error: unknown) => {
        this.cleanupFailure ??= 'RESOURCE_CLEANUP_FAILED'; this.inputError ??= 'RESOURCE_CLEANUP_FAILED';
        this.record('CLEANUP_FAILED', String(error));
      };
      const releasing = [() => this.metronome?.dispose(), () => this.midi?.dispose(),
        () => this.recorder?.stopAndCleanup(), () => this.releaseMicrophone()].map(release => {
        try { return Promise.resolve(release()).catch(failed); }
        catch (error) { failed(error); return Promise.resolve(); }
      });
      try { await Promise.all(releasing); }
      catch (error) { failed(error); }
      finally {
        this.rootStream = null;
        try { if (this.context && this.context.state !== 'closed') await this.context.close(); } catch (error) { failed(error); }
      }
    })(); return this.cleanupPromise;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.abort.abort(); this.state = 'DISPOSED';
    this.disposal = (async () => {
      await this.cleanup(); await this.preparing; await this.completion; await this.releaseCompletedRecording();
      if (this.cleanupFailure) this.state = 'FAILED'; this.listeners.clear();
    })();
    return this.disposal;
  }
  private async releaseCompletedRecording(): Promise<void> {
    const recording = this.completed?.recording; this.completed = null;
    if (recording?.status === 'READY') await releaseRecordingMedia(recording.resource);
  }
  private record(action: string, detail?: string): void { this.diagnostics.push(Object.freeze({ action, state: this.state, performanceTimeMs: this.transport?.performanceTimeMs ?? 0,
    ...(detail ? { detail: detail.slice(0, 256) } : {}) })); if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift(); }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
