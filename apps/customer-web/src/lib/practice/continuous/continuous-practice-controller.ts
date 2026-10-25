import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { type PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import { createLocalSessionId } from '@/lib/practice/kernel/session';
import { type LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';
import { type PracticeInputSource } from '@/lib/practice/kernel/session';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import { immutableContinuousValue, type ContinuousEvaluationSnapshot } from '@/lib/practice/continuous/domain/evaluation/types';
import { completedPerformanceStore, type CompletedPerformance } from '@/lib/practice/completed-performance';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';
import { AudioContextPerformanceClock } from './audio-context-performance-clock';
import { ContinuousMidiInput } from './continuous-midi-input';
import { ContinuousMicrophoneInput } from './continuous-microphone-input';
import { browserContinuousPlatform } from './continuous-platform';
import type { ContinuousMetronomePort, ContinuousPlatform, ContinuousRecorderPort } from './continuous-input';
import { continuousErrorCode, type ContinuousErrorCode } from './continuous-errors';
import { watchMicrophoneInfrastructure } from '@/lib/practice/acoustic/source/microphone-infrastructure';

const DIAGNOSTIC_LIMIT = 32;

export type ContinuousControllerOptions = Readonly<{
  artifact: PracticeScoreArtifact; scope: PracticeScope; inputSource: PracticeInputSource;
  tempoSelection?: PracticeTempoSelection; countInBeats?: number; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode; cameraStream?: MediaStream | null;
  onCompletion?(snapshot: LocalPerformanceSessionSnapshot): void;
}>;
export type ContinuousControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'FINALIZING' | 'COMPLETE' | 'FAILED_BEFORE_START' | 'FAILED' | 'DISPOSED';
export type ContinuousControllerSnapshot = Readonly<{
  session: ContinuousControllerState; transport: PerformanceClockSnapshot | null;
  analysis: 'NOT_REQUIRED' | 'PREPARING' | 'PREROLL' | 'RUNNING' | 'PAUSED' | 'DRAINING' | 'COMPLETE' | 'FAILED';
  analysisError: string | null; inputError: string | null; recording: ReturnType<ContinuousRecorderPort['snapshot']> | null;
  evaluation: ContinuousEvaluationSnapshot | null; completed: CompletedPerformance | null;
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
  private completed: CompletedPerformance | null = null;
  private finalSession: LocalPerformanceSessionSnapshot | null = null;
  private completion: Promise<void> | null = null;
  private preparing: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private cleanupFailure: string | null = null;
  private fatalFailure: ContinuousErrorCode | null = null;
  private detachInfrastructure: (() => void) | null = null;
  private disposed = false;
  private recordingBegan = false;
  private enabled: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly diagnostics: Readonly<{ action: string; state: string; performanceTimeMs: number; detail?: string }>[] = [];
  private readonly tempoPlan;
  constructor(private readonly options: ContinuousControllerOptions, private readonly platform: ContinuousPlatform = browserContinuousPlatform) {
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
      analysis, analysisError: this.analysisError, inputError: this.inputError, recording: this.fatalFailure ? null : this.recorder?.snapshot() ?? null,
      evaluation: this.fatalFailure ? null : this.session?.evaluationSnapshot ?? null, completed: this.state === 'COMPLETE' ? this.completed : null,
      sessionSnapshot: this.state === 'COMPLETE' ? this.finalSession : null });
  }
  engineeringSnapshot() { return Object.freeze({ microphone: this.microphone?.snapshot() ?? null,
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
        this.microphone = new ContinuousMicrophoneInput(this.platform, reason => this.analysisFailed(reason));
        await this.microphone.load(this.abort.signal); this.checkAlive();
        const stream = await this.platform.acquireMicrophone();
        if (this.disposed) { stream.getTracks().forEach(track => track.stop()); this.checkAlive(); }
        this.rootStream = stream; this.checkAlive();
        this.context = this.platform.createAudioContext(); await this.context.resume(); this.checkAlive();
        this.detachInfrastructure = watchMicrophoneInfrastructure(this.rootStream, this.context, code => { void this.failSession(code); });
        this.checkAlive();
        this.renderClock = new AudioContextPerformanceClock(this.context);
      }
      this.session = new ContinuousPracticeSession({ createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), artifact: this.options.artifact, scope: this.options.scope,
        inputSource: this.options.inputSource, tempoPlan: this.tempoPlan, clock: this.renderClock ?? this.platform.midiClock,
        localSessionId: createLocalSessionId(), countInBeats: this.options.countInBeats, metronomeEnabled: this.enabled });
      const session = this.session;
      if (this.microphone) {
        await this.microphone.connect({ context: this.context!, stream: this.rootStream!, sessionDomainId: session.timebase.domainId,
          clock: this.renderClock!, publish: publication => { this.checkAlive(); session.publishAnalysis(publication); this.notify(); } }, this.abort.signal);
      } else {
        this.midi = new ContinuousMidiInput(this.platform, { timebase: session.timebase,
          observe: attack => { session.observeCapturedAttack(attack); this.notify(); },
          onState: state => {
            if (!['ACTIVE', 'PREPARING'].includes(this.state)) return;
            if (state.connectedInputCount === 0 && this.state === 'ACTIVE') {
              if (this.transport?.state !== 'PAUSED') this.pause();
              this.inputError = 'NO_CONNECTED_INPUT'; this.notify();
            } else if (state.connectedInputCount > 0 && this.inputError === 'NO_CONNECTED_INPUT') { this.inputError = null; this.notify(); }
          } });
        await this.midi.prepare();
      }
      this.checkAlive();
      this.recorder = this.platform.createRecorder(this.options.recordingMode ?? 'OFF');
      await this.recorder.prepare({ inputSource: this.options.inputSource, sessionMicrophoneStream: this.rootStream,
        cameraStream: this.options.cameraStream }); this.checkAlive();
      const scope = resolvePracticeScope(this.options.artifact, this.options.scope);
      this.metronome = this.platform.createMetronome({ artifact: this.options.artifact, tempoPlan: this.tempoPlan, enabled: this.enabled,
        mode: 'CONTINUOUS', scopeStartBeat: scope.startBeat, scopeEndBeat: scope.terminalBeat,
        ...(this.context ? { audioContext: this.context } : {}) });
      this.transition(C => {
        this.microphone?.assertBoundary(C);
        this.transport = session.start(); this.planRunning(C); this.metronome!.start(this.transport);
        if (this.transport.state === 'RUNNING') this.startRecording();
      });
      this.state = 'ACTIVE'; this.record('START'); this.timer = setInterval(() => this.refresh(), 10); this.notify();
    } catch (error) {
      if (!this.disposed && !this.fatalFailure) { this.inputError = this.options.inputSource === 'MICROPHONE'
        ? continuousErrorCode(error, 'MODEL_LOAD_FAILED') : (error as Error).message;
        this.record('PREPARATION_FAILED', String(error));
        if (this.options.inputSource === 'MICROPHONE') this.analysisError ??= this.inputError.slice(0, 256);
        this.state = 'FAILED_BEFORE_START'; }
      await this.cleanup(); if (this.cleanupFailure && !this.disposed) this.state = 'FAILED'; this.notify();
    }
  }
  pause(): void {
    if (this.state !== 'ACTIVE') return;
    this.refresh(); if (this.transport?.state === 'ENDED' || this.transport?.state === 'PAUSED') return;
    this.transition(C => {
      const before = this.session!.snapshot();
      if (before.state === 'ENDED') { this.transport = before; return; }
      this.cancelFuture(before.state === 'COUNT_IN');
      this.transport = this.session!.pause();
      if (before.state === 'RUNNING' || this.microphone?.hasRunningSegment) this.boundary('PAUSE', C, this.transport.performanceTimeMs);
      this.recorder?.pause(this.transport.performanceTimeMs); this.metronome?.pause();
    }); this.record('PAUSE'); this.notify();
  }
  resume(): void {
    if (this.state !== 'ACTIVE' || this.transport?.state !== 'PAUSED') return;
    try { this.midi?.assertConnected(); } catch (error) { this.inputError = (error as Error).message; this.notify(); return; }
    this.inputError = null;
    this.transition(C => {
      const T = this.transport!.performanceTimeMs; this.transport = this.session!.resume();
      if (this.transport.performanceTimeMs !== T) throw new Error('CONTINUOUS_RESUME_IDENTITY_VIOLATION');
      this.planRunning(C); this.metronome?.resume(this.transport);
      if (this.transport.state === 'RUNNING') this.recorder?.resume(T);
    }); this.record('RESUME'); this.notify();
  }
  finish(): Promise<void> {
    if (this.completion) return this.completion;
    if (this.state !== 'ACTIVE') return Promise.resolve();
    let mediaStop: Promise<unknown> = Promise.resolve();
    try { this.transition(C => {
      const snapshot = this.session!.snapshot();
      if (snapshot.state !== 'ENDED') this.cancelFuture(snapshot.state === 'COUNT_IN'
        || snapshot.state === 'PAUSED' && snapshot.countInRemainingMs > 0);
      this.transport = snapshot.state === 'ENDED' ? snapshot : this.session!.end('STOPPED_BY_USER');
      // A naturally completed scheduled terminal may already have been applied.
      if (this.transport.completionReason !== 'SCOPE_COMPLETED') this.boundary('TERMINAL', C, this.transport.performanceTimeMs);
      mediaStop = this.recorder?.freeze(this.transport.performanceTimeMs) ?? Promise.resolve();
    }); } catch (error) { return this.failSession(continuousErrorCode(error, 'RECORDER_UNAVAILABLE'), error); }
    return this.complete(mediaStop);
  }
  /** Sampling is presentation-only; lifecycle decisions stay here, not in React. */
  refresh(): void {
    if (this.state !== 'ACTIVE' || !this.session) return;
    this.transport = this.session.snapshot();
    if (this.transport.state === 'RUNNING' && !this.recordingBegan) this.startRecording();
    if (this.transport.state === 'ENDED') {
      try { void this.complete(this.recorder?.freeze(this.transport.performanceTimeMs) ?? Promise.resolve()); }
      catch (error) { void this.failSession('RECORDER_UNAVAILABLE', error); } return;
    }
    this.notify();
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.enabled = enabled; this.session?.setMetronomeEnabled(enabled); this.metronome?.setEnabled(enabled);
    if (enabled && this.transport) this.metronome?.syncContinuous(this.transport);
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
  private transition(action: (C: number) => void): void { if (this.renderClock) this.renderClock.transaction(action); else action(0); }
  private complete(mediaStop: Promise<unknown>): Promise<void> {
    if (this.completion) return this.completion;
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
        // Optional media availability is independent of Practice evaluation and completion.
        const media = await this.recorder!.finalize(); this.checkAlive();
        const session = this.session!; this.finalSession = session.snapshotSession();
        const evaluation = this.analysisError ? Object.freeze({ status: 'UNAVAILABLE' as const, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' as const })
          : session.completedEvaluation();
        this.completed = immutableContinuousValue({ localSessionId: this.finalSession.localSessionId,
          scoreId: this.finalSession.scoreId, revisionId: this.finalSession.revisionId, artifactId: this.finalSession.artifactId,
          scope: resolvePracticeScope(this.options.artifact, this.options.scope), tempoPlan: this.tempoPlan,
          inputSource: this.options.inputSource, activeElapsedMs: this.finalSession.performance.activeElapsedMs,
          evaluation, media: media.media, recordingTimebase: media.timebase, completedAt: new Date().toISOString() });
        await this.cleanup(); this.checkAlive();
        this.state = 'COMPLETE'; completedPerformanceStore.setPerformance(this.completed); this.record('COMPLETE');
        this.notify(); this.options.onCompletion?.(this.finalSession);
      } catch (error) {
        if (!this.disposed) await this.failSession(continuousErrorCode(error, this.cleanupFailure ? 'RESOURCE_CLEANUP_FAILED' : 'RECORDER_UNAVAILABLE'), error);
      } finally { if (this.disposed) await this.cleanup(); }
    })();
    return this.completion;
  }
  private analysisFailed(reason: string): void {
    if (this.fatalFailure || this.disposed) return;
    this.analysisError ??= continuousErrorCode(reason, 'ANALYSIS_FAILED'); this.record('ANALYSIS_FAILED', reason); this.notify();
  }
  private async failSession(code: ContinuousErrorCode, cause: unknown = code): Promise<void> {
    if (this.disposed || this.fatalFailure || this.state === 'COMPLETE') return;
    this.fatalFailure = code; this.inputError = code; this.analysisError = code;
    this.completed = null; this.finalSession = null; this.state = 'FAILED';
    this.abort.abort(); this.microphone?.fail(code); this.record('SESSION_FAILED', String(cause)); this.notify();
    await this.cleanup(); this.notify();
  }
  private checkAlive(): void {
    if (this.disposed || this.abort.signal.aborted) throw new Error('CONTINUOUS_DISPOSED');
    if (this.fatalFailure || this.cleanupFailure) throw new Error(this.fatalFailure ?? this.cleanupFailure!);
    if (this.state === 'PREPARING' && this.analysisError) throw new Error(this.analysisError);
  }
  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.detachInfrastructure?.(); this.detachInfrastructure = null;
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
        const root = this.rootStream; this.rootStream = null;
        for (const track of root?.getTracks() ?? []) { try { track.stop(); } catch (error) { failed(error); } }
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
