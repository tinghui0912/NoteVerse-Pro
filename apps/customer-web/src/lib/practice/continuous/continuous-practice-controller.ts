import type { PracticeDeviceRoots } from '@/lib/practice/device/device-contract';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { ContinuousMicrophoneResources, type MicrophoneResourceHealth } from './microphone-resource-health';
import { continuousCompletionStore } from './completion-store';
import type { ContinuousPracticeCompletion } from './completion';
import { createNaturalContinuousCompletion } from './natural-completion';
import { midiEvidenceProvenance, microphoneEvidenceProvenance, type ContinuousEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import { sourceRate } from '@/lib/practice/acoustic/model/model-contract';
import { type ContinuousEvaluationSnapshot } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import { type PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { type LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';
import { createLocalSessionId, type PracticeInputSource } from '@/lib/practice/kernel/session';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import { recordingPreparationError, RecordingPreparationError } from '@/lib/practice/recording/recording-preparation-error';
import type { RecordingRuntimeFault } from '@/lib/practice/recording/recording-runtime-fault';
import type { PracticeResourceIntervention } from './resource-intervention';
import { AudioContextPerformanceClock } from './audio-context-performance-clock';
import { continuousErrorCode, type ContinuousErrorCode } from './continuous-errors';
import type { ContinuousMetronomePort, ContinuousPlatform, ContinuousRecorderPort } from './continuous-input';
import { ContinuousMicrophoneInput } from './continuous-microphone-input';
import { ContinuousMidiInput } from './continuous-midi-input';
import { browserContinuousPlatform } from './continuous-platform';

import { continuousMetronomeSyncPoint } from './metronome-sync';

const DIAGNOSTIC_LIMIT = 32;

export type ContinuousControllerOptions = Readonly<{
  devices: PracticeDeviceRoots;
  observeDevices?: (listener: () => void) => () => void;
  startupTimings?: PracticeStartupTimings;
  artifact: PracticeScoreArtifact; scope: PracticeScope; inputSource: PracticeInputSource;
  tempoSelection?: PracticeTempoSelection; countInBeats?: number; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode;
  onNaturalCompletion?(snapshot: LocalPerformanceSessionSnapshot): void;
}>;
export type ContinuousControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'FINALIZING' | 'COMPLETE' | 'FAILED_BEFORE_START' | 'FAILED' | 'ABANDONED' | 'DISPOSED';
export type ContinuousControllerSnapshot = Readonly<{
  session: ContinuousControllerState; transport: PerformanceClockSnapshot | null;
  analysis: 'NOT_REQUIRED' | 'PREPARING' | 'PREROLL' | 'RUNNING' | 'PAUSED' | 'DRAINING' | 'COMPLETE' | 'FAILED';
  analysisError: string | null; inputError: string | null; recording: ReturnType<ContinuousRecorderPort['snapshot']> | null;
  resourceIntervention: PracticeResourceIntervention | null;
  evaluation: ContinuousEvaluationSnapshot | null; completed: ContinuousPracticeCompletion | null;
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
  private metronome: ContinuousMetronomePort | null = null;
  private context: AudioContext | null = null;
  private rootStream: MediaStream | null = null;
  private renderClock: AudioContextPerformanceClock | null = null;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private futureBegin: string | null = null;
  private futureTerminal: string | null = null;
  private inputError: string | null = null;
  private analysisError: string | null = null;
  private completed: ContinuousPracticeCompletion | null = null;
  private evidenceProvenance: ContinuousEvidenceProvenance | null = null;
  private finalSession: LocalPerformanceSessionSnapshot | null = null;
  private completion: Promise<void> | null = null;
  private abandonment: Promise<void> | null = null;
  private preparing: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private cleanupFailure: string | null = null;
  private fatalFailure: ContinuousErrorCode | null = null;
  private inputResources: ContinuousMicrophoneResources | null = null;
  private inputIncident: MicrophoneResourceHealth | null = null;
  private updatingIntervention = false;
  private disposed = false;
  private recordingBegan = false;
  private resumeRecordingAt: number | null = null;
  private intervention: PracticeResourceIntervention | null = null;
  private detachDevices: (() => void) | null = null;
  private detachRecorder: (() => void) | null = null;
  private transitioning = false;
  private pendingRecordingFault: RecordingRuntimeFault | null = null;
  private enabled: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly diagnostics: Readonly<{ action: string; state: string; performanceTimeMs: number; detail?: string }>[] = [];
  private readonly tempoPlan;
  private readonly startup: PracticeStartupTimings;
  constructor(private readonly options: ContinuousControllerOptions, private readonly platform: ContinuousPlatform = browserContinuousPlatform()) {
    this.startup = options.startupTimings ?? new PracticeStartupTimings();
    this.tempoPlan = resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' });
    this.enabled = options.metronomeEnabled ?? false;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): ContinuousControllerSnapshot {
    const runtimeState = this.microphone?.snapshot().runtime?.state;
    const analysis = this.options.inputSource === 'MIDI' ? 'NOT_REQUIRED' : this.analysisError ? 'FAILED'
      : this.state === 'PREPARING' ? runtimeState === 'PREROLL' ? 'PREROLL' : 'PREPARING'
      : this.state === 'COMPLETE' ? 'COMPLETE' : this.state === 'FINALIZING' ? 'DRAINING'
      : this.transport?.state === 'PAUSED' ? 'PAUSED' : this.transport?.state === 'RUNNING' ? 'RUNNING' : 'PREROLL';
    return Object.freeze({ session: this.state, transport: this.transport ? Object.freeze({ ...this.transport }) : null,
      analysis, analysisError: this.analysisError, inputError: this.inputError, recording: this.fatalFailure ? null : this.recorder?.snapshot(this.transport?.performanceTimeMs ?? 0) ?? null,
      resourceIntervention: this.intervention,
      evaluation: this.fatalFailure || ['FAILED_BEFORE_START', 'ABANDONED', 'DISPOSED'].includes(this.state) ? null : this.session?.evaluationSnapshot ?? null, completed: this.state === 'COMPLETE' ? this.completed : null,
      sessionSnapshot: this.state === 'COMPLETE' ? this.finalSession : null });
  }
  engineeringSnapshot() { return Object.freeze({ startup: this.startup.snapshot(), sessionId: this.session?.timebase.domainId ?? null, microphone: this.microphone?.snapshot() ?? null,
    diagnostics: Object.freeze([...this.diagnostics]), diagnosticLimit: DIAGNOSTIC_LIMIT,
    diagnosticPlanningBytes: DIAGNOSTIC_LIMIT * 1024, rootTrackStates: this.rootStream?.getTracks().map(t => t.readyState) ?? [],
    audioContextState: this.context?.state ?? 'CLOSED', audioContextRate: this.context?.sampleRate ?? null }); }
  start(): Promise<void> {
    if (this.preparing) return this.preparing;
    if (this.state !== 'IDLE' || this.disposed) return Promise.reject(new Error('CONTINUOUS_SESSION_NOT_IDLE'));
    this.state = 'PREPARING'; this.notify();
    this.preparing = this.prepareAndStart(); return this.preparing;
  }
  private async prepareAndStart(): Promise<void> {
    try {
      if (this.options.inputSource === 'MICROPHONE') {
        this.microphone = new ContinuousMicrophoneInput(this.platform, reason => this.analysisFailed(reason), this.startup);
        await this.startup.measure('acquireInferenceLease', () => this.microphone!.acquire(this.abort.signal)); this.checkAlive();
        this.rootStream = this.options.devices.inputMicrophone;
        if (!this.rootStream?.getAudioTracks().some(track => track.readyState === 'live')) throw new Error('MICROPHONE_SOURCE_LOST');
        this.checkAlive();
        this.context = this.platform.createAudioContext(); await this.startup.measure('audioContextResume', () => this.context!.resume()); this.checkAlive();
        this.inputResources = new ContinuousMicrophoneResources(this.rootStream, this.context, health => this.inputHealthChanged(health));
        this.checkAlive();
        this.renderClock = new AudioContextPerformanceClock(this.context);
        this.evidenceProvenance = microphoneEvidenceProvenance(sourceRate(this.context.sampleRate));
      }
      this.session = new ContinuousPracticeSession({
        ...(this.options.inputSource === 'MIDI'
          ? { inputSource: 'MIDI' as const, createClockEvidence: (domainId: string) => {
              const evidence = new ContinuousMidiEvidence(domainId);
              this.evidenceProvenance = midiEvidenceProvenance(evidence.evidencePolicyId); return evidence;
            } }
          : { inputSource: 'MICROPHONE' as const }), artifact: this.options.artifact, scope: this.options.scope,
        tempoPlan: this.tempoPlan, clock: this.renderClock ?? this.platform.midiClock,
        localSessionId: createLocalSessionId(), countInBeats: this.options.countInBeats, metronomeEnabled: this.enabled });
      const session = this.session;
      if (this.microphone) {
        await this.microphone.connect({ context: this.context!, stream: this.rootStream!, sessionDomainId: session.timebase.domainId,
          clock: this.renderClock!, publish: publication => { this.checkAlive(); session.publishAnalysis(publication); this.notify(); } }, this.abort.signal);
      } else {
        this.midi = new ContinuousMidiInput(this.platform, { access: this.options.devices.midi!, timebase: session.timebase,
          observe: attack => { session.observeMidiAttack(attack); this.notify(); },
          onState: state => {
            if (!['ACTIVE', 'PREPARING'].includes(this.state)) return;
            if (state.connectedInputCount === 0 && this.state === 'ACTIVE') {
              if (this.transport?.state !== 'PAUSED') this.pause();
              this.inputError = 'NO_CONNECTED_INPUT'; this.updateResourceIntervention(); this.notify();
            } else if (state.connectedInputCount > 0 && this.inputError === 'NO_CONNECTED_INPUT') { this.inputError = null; this.updateResourceIntervention(); this.notify(); }
          } });
        await this.startup.measure('midiBind', () => this.midi!.prepare());
      }
      this.checkAlive();
      try {
        this.recorder = this.platform.createRecorder(this.options.recordingMode ?? 'OFF');
        await this.startup.measure('recorderAdmission', () => this.recorder!.prepare({ audioRoot: this.options.inputSource === 'MICROPHONE' ? this.rootStream : this.options.devices.recordingMicrophone,
          cameraStream: this.options.devices.camera }));
      } catch (error) { throw recordingPreparationError(error); }
      this.detachRecorder = this.recorder.onRuntimeFault(fault => {
        if (this.transitioning) this.pendingRecordingFault = fault;
        else this.recordingFault(fault);
      });
      this.detachDevices = this.options.observeDevices?.(() => this.recorder?.observeDeviceHealth()) ?? null;
      this.checkAlive();
      const scope = resolvePracticeScope(this.options.artifact, this.options.scope);
      this.metronome = this.platform.createMetronome({ artifact: this.options.artifact, tempoPlan: this.tempoPlan, enabled: this.enabled,
        mode: 'CONTINUOUS', scopeStartBeat: scope.startBeat, scopeEndBeat: scope.terminalBeat,
        ...(this.context ? { audioContext: this.context } : {}) });
      this.transition(C => {
        try { this.recorder!.assertPrepared(); } catch (error) { throw recordingPreparationError(error); }
        this.microphone?.assertBoundary(C);
        this.recorder!.activate(); this.transport = session.start(); this.state = 'ACTIVE';
        this.planRunning(C); this.metronome!.start(continuousMetronomeSyncPoint(this.transport));
        if (this.transport.state === 'RUNNING') this.startRecording();
      });
      this.state = 'ACTIVE'; this.record('START'); this.timer = setInterval(() => this.refresh(), 10); this.notify();
    } catch (error) {
      if (!this.disposed && this.state !== 'ABANDONED' && !this.fatalFailure) { this.inputError = error instanceof RecordingPreparationError
        ? 'RECORDING_PREPARATION_FAILED' : this.options.inputSource === 'MICROPHONE' ? continuousErrorCode(error, 'MODEL_LOAD_FAILED') : (error as Error).message;
        this.record('PREPARATION_FAILED', String(error));
        if (this.options.inputSource === 'MICROPHONE' && !(error instanceof RecordingPreparationError)) this.analysisError ??= this.inputError.slice(0, 256);
        this.state = 'FAILED_BEFORE_START'; }
      await this.cleanup(); if (this.cleanupFailure && !this.disposed) this.state = 'FAILED'; this.notify();
    }
  }
  pause(): void {
    if (this.intervention) this.intervention = Object.freeze({ ...this.intervention, pauseOrigin: 'USER' });
    this.pauseTransport();
  }
  private pauseTransport(): void {
    if (this.state !== 'ACTIVE') return;
    this.refresh(); if (this.transport?.state === 'ENDED' || this.transport?.state === 'PAUSED') return;
    this.transition(C => {
      const before = this.session!.snapshot();
      if (before.state === 'ENDED') { this.transport = before; return; }
      this.cancelFuture(before.state === 'COUNT_IN');
      this.transport = this.session!.pause();
      if ((before.state === 'RUNNING' || before.countInKind === 'INITIAL' && this.microphone?.hasRunningSegment) && this.context?.state !== 'closed' && !this.microphone?.snapshot().capture?.failed) this.boundary('PAUSE', C, this.transport.performanceTimeMs);
      this.recorder?.pause(this.transport.performanceTimeMs); this.metronome?.pause();
    }); this.record('PAUSE'); this.notify();
  }
  resume(): void {
    if (this.intervention || this.inputResources && !this.inputResources.snapshot().healthy || this.state !== 'ACTIVE' || this.transport?.state !== 'PAUSED') return;
    try { this.midi?.assertConnected(); } catch (error) { this.inputError = (error as Error).message; this.notify(); return; }
    this.inputError = null;
    this.transition(C => {
      const T = this.transport!.performanceTimeMs; this.transport = this.session!.resume();
      if (this.transport.performanceTimeMs !== T) throw new Error('CONTINUOUS_RESUME_IDENTITY_VIOLATION');
      this.planRunning(C); this.metronome?.resume(continuousMetronomeSyncPoint(this.transport));
      this.resumeRecordingAt = T;
      if (this.transport.state === 'RUNNING') { this.recorder?.resume(T); this.resumeRecordingAt = null; }
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
    this.intervention = null;
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
    this.enabled = enabled; this.session?.setMetronomeEnabled(enabled); this.metronome?.setEnabled(enabled);
    if (enabled && this.transport) this.metronome?.syncContinuous(continuousMetronomeSyncPoint(this.transport));
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
    catch (error) { this.microphone.fail((error as Error).message); this.analysisFailed((error as Error).message);
      if (this.state === 'PREPARING') throw error; return null; }
  }
  private transition(action: (C: number) => void): void {
    this.transitioning = true;
    try { if (this.renderClock) this.renderClock.transaction(action); else action(0); }
    finally {
      this.transitioning = false;
      const fault = this.pendingRecordingFault; this.pendingRecordingFault = null;
      if (fault) this.recordingFault(fault);
    }
  }
  private recordingFault(_fault: RecordingRuntimeFault): void { this.updateResourceIntervention(); }
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
    if (this.updatingIntervention || this.disposed || this.state !== 'ACTIVE' || this.session?.clock.terminationReason === 'SCOPE_COMPLETED') return;
    const liveInput = this.inputResources?.snapshot();
    if (liveInput && !liveInput.healthy) this.inputIncident = liveInput;
    const recording = this.recorder?.runtimeFault();
    let input = this.inputIncident;
    if (!input && !recording) return;
    this.updatingIntervention = true;
    try {
      const pauseOrigin = this.intervention?.pauseOrigin ?? (this.transport?.state === 'PAUSED' ? 'USER' : 'INTERVENTION');
      this.pauseTransport();
      input = this.inputIncident;
      if (this.state !== 'ACTIVE' || this.transport?.state !== 'PAUSED') return;
      const currentRecording = this.recorder?.runtimeFault();
      const inputRequired = Boolean(input || this.inputError === 'NO_CONNECTED_INPUT');
      const hard = input?.recoverability === 'RESTART_REQUIRED' || currentRecording?.recoverability === 'RESTART_REQUIRED';
      const recovered = !hard && (!input || input.healthy) && this.inputError !== 'NO_CONNECTED_INPUT'
        && (!currentRecording || currentRecording.state === 'RECOVERED_WAITING_FOR_USER');
      this.intervention = Object.freeze({ impact: inputRequired ? (this.options.recordingMode && this.options.recordingMode !== 'OFF' ? 'INPUT_AND_RECORDING' : 'INPUT_REQUIRED') : 'RECORDING_ONLY',
        reason: input?.reason ?? (this.inputError === 'NO_CONNECTED_INPUT' ? 'NO_CONNECTED_INPUT' : currentRecording!.reason),
        recoverability: hard ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE',
        state: recovered ? 'RECOVERED_WAITING_FOR_USER' : 'WAITING_FOR_USER', pauseOrigin });
      this.record('RESOURCE_INTERVENTION', this.intervention.impact); this.notify();
    } finally { this.updatingIntervention = false; }
  }
  continueWithoutRecording(): void {
    if (this.intervention?.impact !== 'RECORDING_ONLY' || this.intervention.state !== 'WAITING_FOR_USER' || this.state !== 'ACTIVE'
      || this.inputResources && !this.inputResources.snapshot().healthy || this.inputError === 'NO_CONNECTED_INPUT') return;
    try { this.midi?.assertConnected(); } catch { this.inputError = 'NO_CONNECTED_INPUT'; this.updateResourceIntervention(); return; }
    const resume = this.intervention.pauseOrigin === 'INTERVENTION';
    this.recorder!.continueWithoutRecording(); this.intervention = null;
    this.record('RECORDING_LOSS_ACCEPTED'); if (resume) this.resume(); this.notify();
  }
  continueAfterRecovery(): boolean {
    if (this.intervention?.state !== 'RECOVERED_WAITING_FOR_USER' || this.state !== 'ACTIVE'
      || this.inputResources && !this.inputResources.snapshot().healthy || this.inputError === 'NO_CONNECTED_INPUT') return false;
    if (this.recorder?.runtimeFault() && !this.recorder.recoverRuntime()) return false;
    const resume = this.intervention.pauseOrigin === 'INTERVENTION'; this.inputIncident = null; this.intervention = null;
    if (resume) this.resume(); this.notify(); return this.intervention === null;
  }
  private completeNaturally(mediaStop: Promise<unknown>): Promise<void> {
    if (this.completion) return this.completion;
    if (this.session?.clock.terminationReason !== 'SCOPE_COMPLETED') throw new Error('Continuous completion requires a naturally completed scope.');
    this.intervention = null;
    this.state = 'FINALIZING'; if (this.timer) clearInterval(this.timer); this.timer = null; this.metronome?.stop(); this.notify();
    // Observe unexpected stop rejection immediately, even while acoustic tail work is pending.
    const stopped = mediaStop.catch(error => this.failSession('RECORDER_UNAVAILABLE', error));
    this.completion = (async () => {
      try {
        if (this.microphone && !this.analysisError) {
          try { await this.microphone.finish(this.abort.signal); }
          catch (error) { if (this.disposed) return; this.analysisFailed((error as Error).message); }
        }
        await stopped; this.checkAlive();
        // After admission and Start, media degradation is independent of evaluation and completion.
        const recording = await this.recorder!.finalize(); this.checkAlive();
        const session = this.session!; this.finalSession = session.snapshotSession();
        const evaluation = this.analysisError ? unavailableContinuousEvaluation(this.options.inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE')
          : session.completedEvaluation();
        if (!this.evidenceProvenance) throw new Error('CONTINUOUS_EVIDENCE_IDENTITY_UNAVAILABLE');
        this.completed = createNaturalContinuousCompletion({ session: this.finalSession,
          artifact: this.options.artifact, scope: this.options.scope, tempoPlan: this.tempoPlan,
          evaluation, evidenceProvenance: this.evidenceProvenance, recording, completedAt: new Date().toISOString() });
        await this.cleanup(); this.checkAlive();
        this.state = 'COMPLETE'; continuousCompletionStore.setCompletion(this.completed); this.record('COMPLETE');
        this.notify(); this.options.onNaturalCompletion?.(this.finalSession);
      } catch (error) {
        if (!this.disposed) await this.failSession(continuousErrorCode(error, this.cleanupFailure ? 'RESOURCE_CLEANUP_FAILED' : 'RECORDER_UNAVAILABLE'), error);
      } finally { if (this.disposed) await this.cleanup(); }
    })();
    return this.completion;
  }
  private analysisFailed(reason: string): void {
    if (this.fatalFailure || this.disposed || this.state === 'ABANDONED') return;
    if (this.state === 'ACTIVE' && this.microphone?.snapshot().capture?.failed) {
      this.inputHealthChanged({ healthy: false, reason: 'CAPTURE_PIPELINE_INVALID', recoverability: 'RESTART_REQUIRED' }); return;
    }
    this.analysisError ??= continuousErrorCode(reason, 'ANALYSIS_FAILED'); this.record('ANALYSIS_FAILED', reason); this.notify();
  }
  private async failSession(code: ContinuousErrorCode, cause: unknown = code): Promise<void> {
    if (this.disposed || this.fatalFailure || ['COMPLETE', 'ABANDONED'].includes(this.state)) return;
    this.fatalFailure = code; this.inputError = code; this.analysisError = code;
    this.completed = null; this.finalSession = null; this.state = 'FAILED';
    this.abort.abort(); this.microphone?.fail(code); this.record('SESSION_FAILED', String(cause)); this.notify();
    await this.cleanup(); this.notify();
  }
  private checkAlive(): void {
    if (this.disposed || this.state === 'ABANDONED' || this.abort.signal.aborted) throw new Error('CONTINUOUS_DISPOSED');
    if (this.fatalFailure || this.cleanupFailure) throw new Error(this.fatalFailure ?? this.cleanupFailure!);
    if (this.state === 'PREPARING' && this.analysisError) throw new Error(this.analysisError);
  }
  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.inputResources?.dispose(); this.inputResources = null; this.inputIncident = null;
    this.detachDevices?.(); this.detachDevices = null; this.detachRecorder?.(); this.detachRecorder = null; this.intervention = null; this.pendingRecordingFault = null;
    this.cleanupPromise = (async () => {
      const failed = (error: unknown) => {
        this.cleanupFailure ??= 'RESOURCE_CLEANUP_FAILED'; this.inputError ??= 'RESOURCE_CLEANUP_FAILED';
        this.record('CLEANUP_FAILED', String(error));
      };
      for (const release of [() => this.metronome?.destroy(), () => this.midi?.dispose(), () => this.recorder?.stopAndCleanup()]) {
        try { release(); } catch (error) { failed(error); }
      }
      try { await this.microphone?.dispose(); }
      catch (error) { failed(error); }
      finally {
        this.rootStream = null;
        try { if (this.context && this.context.state !== 'closed') await this.context.close(); } catch (error) { failed(error); }
      }
    })(); return this.cleanupPromise;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return this.cleanup(); this.disposed = true; this.abort.abort(); this.state = 'DISPOSED';
    await this.cleanup(); await this.completion; if (this.cleanupFailure) this.state = 'FAILED'; this.listeners.clear();
  }
  private record(action: string, detail?: string): void { this.diagnostics.push(Object.freeze({ action, state: this.state, performanceTimeMs: this.transport?.performanceTimeMs ?? 0,
    ...(detail ? { detail: detail.slice(0, 256) } : {}) })); if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift(); }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
