import { SourceAnalysisRuntime } from '../acoustic/runtime/source-analysis-runtime';
import type { SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import { PracticeTimebase, type LocalClock, type SessionTime } from '../local-core/timebase';
import type { StepAttemptEvidence } from '../local-core/step-attempt';
import { StepAcousticAttemptAssembler, type StepAcousticAttemptSink } from './step-acoustic-attempt-assembler';
import { StepAcousticCaptureBridge } from './step-acoustic-capture-bridge';
import type { StepMicrophonePlatform, StepMicrophoneWorker } from './step-microphone-platform';

export type StepMicrophoneRetirementBoundary = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: 44100 | 48000; capturedThroughSourceSample: number;
  sessionTime: Readonly<SessionTime>; sequence: number;
}>;
export type StepMicrophoneConnection = Readonly<{
  context: AudioContext; stream: MediaStream; localSessionId: string; sourceDomainId: string;
}>;
export type StepMicrophoneSink<Identity> = StepAcousticAttemptSink<Identity> & Readonly<{ failure(error: Error): void }>;

/** Resource ownership only; neither domain correctness nor application rearm lives here. */
export class StepMicrophoneInput<Identity> {
  private state: 'NEW' | 'PREPARING' | 'AVAILABLE' | 'FAILED' | 'DISPOSED' = 'NEW';
  private connection: StepMicrophoneConnection | null = null;
  private worker: StepMicrophoneWorker | null = null;
  private runtime: SourceAnalysisRuntime | null = null;
  private bridge: StepAcousticCaptureBridge | null = null;
  private assembler: StepAcousticAttemptAssembler<Identity> | null = null;
  private timebase: PracticeTimebase | null = null;
  private capture: { stop(): void } | null = null;
  private detachWorker: (() => void) | undefined;
  private detachSignal: (() => void) | undefined;
  private setupTask: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private failure: Error | null = null;
  private captureConnected = false;
  private delivering = false;
  private notifying = false;
  private completed: { identity: Identity; evidence: StepAttemptEvidence } | null = null;
  private regionStarted = false;
  private publications = 0;
  private sequence = 0;
  private issued: StepMicrophoneRetirementBoundary | null = null;
  private retiredThrough = -1;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
  readonly clock: LocalClock = Object.freeze({ nowMs: () => {
    if (!this.connection) throw new Error('STEP_MICROPHONE_CONTEXT_NOT_ATTACHED');
    return this.connection.context.currentTime * 1000;
  } });

  constructor(private readonly platform: StepMicrophonePlatform, private readonly sink: StepMicrophoneSink<Identity>) {
    void this.ready.catch(() => {});
  }

  start(connection: StepMicrophoneConnection, signal: AbortSignal): Promise<StepMicrophoneRetirementBoundary> {
    if (this.state !== 'NEW') return Promise.reject(new Error('STEP_MICROPHONE_START_ONCE'));
    this.state = 'PREPARING'; this.connection = Object.freeze({ ...connection });
    const aborted = () => this.fail(new Error('STEP_MICROPHONE_ABORTED'));
    signal.addEventListener('abort', aborted, { once: true });
    this.detachSignal = () => signal.removeEventListener('abort', aborted);
    connection.context.addEventListener('statechange', this.contextChanged);
    this.setupTask = this.setup(signal);
    return this.setupTask.then(async () => {
      this.check(); this.captureConnected = true; this.maybeReady(); await this.ready; this.check();
      return this.retirementBoundary();
    }).catch(error => { this.fail(error); throw error; });
  }

  /** An issued physical fact, not a caller-provided timestamp or acoustic processed frontier. */
  retirementBoundary(): StepMicrophoneRetirementBoundary {
    try {
      this.check();
      if (this.delivering || this.state !== 'AVAILABLE' || this.assembler?.snapshot().phase !== 'BLOCKED') {
        throw new Error('STEP_MICROPHONE_RETIREMENT_NOT_AVAILABLE');
      }
      const capture = this.bridge!.snapshot(), sample = capture.capturedThroughSourceSample;
      if (!Number.isSafeInteger(sample) || sample < this.retiredThrough) throw new Error('STEP_MICROPHONE_RETIREMENT_INVALID');
      this.issued = Object.freeze({ sourceDomainId: this.connection!.sourceDomainId, sourceSampleRateHz: capture.sourceSampleRateHz,
        capturedThroughSourceSample: sample, sessionTime: Object.freeze(this.timebase!.sampleIndexToSessionTime(sample)), sequence: ++this.sequence });
      return this.issued;
    } catch (error) { this.fail(error); throw error; }
  }

  /** Retire an armed, idle input before an application target transition, never an active gesture. */
  transitionBoundary(): StepMicrophoneRetirementBoundary {
    try {
      this.check();
      if (this.delivering || this.notifying || this.state !== 'AVAILABLE' || this.assembler?.snapshot().phase !== 'READY') {
        throw new Error('STEP_MICROPHONE_TRANSITION_NOT_AVAILABLE');
      }
      this.assembler.suspend();
      return this.retirementBoundary();
    } catch (error) { this.fail(error); throw error; }
  }

  /** Call synchronously after the application's domain retirement commit. Failure is terminal, never rollback. */
  arm(boundary: StepMicrophoneRetirementBoundary): void {
    try {
      this.check();
      const capture = this.bridge!.snapshot();
      if (this.delivering || this.state !== 'AVAILABLE' || boundary !== this.issued
        || boundary.sourceDomainId !== this.connection!.sourceDomainId || boundary.sourceSampleRateHz !== capture.sourceSampleRateHz
        || boundary.capturedThroughSourceSample !== capture.capturedThroughSourceSample
        || boundary.capturedThroughSourceSample < this.retiredThrough
        || boundary.sessionTime.domainId !== this.connection!.localSessionId
        || boundary.sessionTime.sampleIndex !== boundary.capturedThroughSourceSample
        || boundary.sessionTime.ms !== this.timebase!.sampleIndexToSessionTime(boundary.capturedThroughSourceSample).ms) {
        throw new Error('STEP_MICROPHONE_RETIREMENT_INVALID');
      }
      this.assembler!.acceptInputAfter(boundary.capturedThroughSourceSample);
      this.retiredThrough = boundary.capturedThroughSourceSample; this.issued = null;
    } catch (error) { this.fail(error); throw error; }
  }

  snapshot() {
    return Object.freeze({ resourceState: this.state, failure: this.failure?.message ?? null, publications: this.publications,
      retiredThroughSourceSample: this.retiredThrough, retirementSequence: this.sequence, regionStarted: this.regionStarted,
      capture: this.bridge?.snapshot() ?? null, analysis: this.runtime?.snapshot() ?? null, assembler: this.assembler?.snapshot() ?? null });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    if (!this.failure) this.state = 'DISPOSED';
    this.rejectReady(new Error('STEP_MICROPHONE_DISPOSED'));
    this.detachSignal?.(); this.detachSignal = undefined;
    this.connection?.context.removeEventListener('statechange', this.contextChanged);
    this.bridge?.dispose();
    try { this.assembler?.suspend(); } catch { /* Already failed/reentrant ownership is never reused. */ }
    // Publication delivery must unwind before SourceAnalysisRuntime disposal; never end a region reentrantly.
    this.disposal = Promise.resolve().then(async () => {
      try { await this.setupTask; } catch { /* Preserve setup/failure reason. */ }
      this.capture?.stop(); this.detachWorker?.(); this.detachWorker = undefined;
      if (this.runtime) await this.runtime.dispose(); else await this.worker?.dispose();
    });
    void this.disposal.catch(error => this.fail(error));
    return this.disposal;
  }

  private async setup(signal: AbortSignal): Promise<void> {
    const c = this.connection!;
    if (signal.aborted || c.context.state !== 'running' || ![44100, 48000].includes(c.context.sampleRate)
      || !c.localSessionId || !c.sourceDomainId || c.sourceDomainId.length > 192) throw new Error('STEP_MICROPHONE_CONNECTION_INVALID');
    const url = await this.platform.modelUrl(signal); this.check();
    this.worker = this.platform.createWorker();
    this.detachWorker = this.worker.onFailure?.(error => this.fail(error));
    await this.worker.load(url); this.check();
    const coefficientBytes = await this.platform.coefficients(c.context.sampleRate); this.check();
    this.runtime = await SourceAnalysisRuntime.create({ sourceDomainId: c.sourceDomainId, sourceSampleRateHz: c.context.sampleRate,
      coefficientBytes, worker: { run: input => this.worker!.run(input), dispose: () => this.worker!.dispose() },
      nowAvailabilityMs: () => c.context.currentTime * 1000,
      onPublication: publication => this.publication(publication), onFailure: error => this.fail(error) });
    this.check();
    this.bridge = new StepAcousticCaptureBridge(this.runtime, c.context.sampleRate as 44100 | 48000,
      () => this.captured(), error => this.fail(error));
    this.capture = await this.platform.connectCapture({ bridge: this.bridge, stream: c.stream, ownership: 'BORROWED_SESSION_STREAM',
      context: c.context, workletUrl: this.platform.workletUrl });
    if (this.closed()) this.capture.stop();
    this.check();
  }

  private captured(): void {
    this.check();
    const c = this.connection!, capture = this.bridge!.snapshot(), origin = capture.audioContextOriginFrame;
    if (origin === null || !Number.isSafeInteger(origin) || origin < 0) throw new Error('STEP_MICROPHONE_SOURCE_MAPPING_INVALID');
    if (!this.assembler) {
      const rate = capture.sourceSampleRateHz;
      this.timebase = new PracticeTimebase({ domainId: c.localSessionId, sampleRateHz: rate, anchorSampleIndex: 0,
        anchorSessionTimeMs: origin / rate * 1000 });
      this.assembler = new StepAcousticAttemptAssembler({ sourceDomainId: c.sourceDomainId, sourceSampleRateHz: rate,
        localSessionId: c.localSessionId, sourceAnchorSample: 0, sessionAnchorTime: this.timebase.sampleIndexToSessionTime(0), sink: {
          open: time => { this.check(); return this.sink.open(time); },
          complete: (identity, evidence) => { this.check(); this.completed = { identity, evidence }; },
        } });
    }
    if (!this.regionStarted && this.runtime!.prerollReady) {
      this.runtime!.beginAnalysisRegion(capture.capturedThroughSourceSample); this.regionStarted = true;
    }
    this.maybeReady();
  }

  private maybeReady(): void {
    if (this.state === 'PREPARING' && this.captureConnected && this.regionStarted && this.assembler) {
      this.state = 'AVAILABLE'; this.resolveReady();
    }
  }

  private publication(publication: SourceAcousticPublication): void {
    if (this.closed()) return;
    try {
      if (this.delivering || this.notifying || !this.assembler || !this.bridge
        || publication.ownedThroughSourceSample > this.bridge.snapshot().capturedThroughSourceSample) {
        throw new Error('STEP_MICROPHONE_PUBLICATION_INVALID');
      }
      this.delivering = true;
      this.assembler.accept(publication); this.check(); this.publications++;
      this.delivering = false;
      // The assembler must unwind before the application commits retirement and arms it.
      // Keep notification reentrancy forbidden, without inserting an asynchronous gap.
      const completed = this.completed; this.completed = null;
      if (completed) {
        this.notifying = true;
        this.sink.complete(completed.identity, completed.evidence);
        if (this.state !== 'DISPOSED') this.check();
      }
    } catch (error) { this.fail(error); throw error; }
    finally { this.delivering = false; this.notifying = false; this.completed = null; }
  }

  private readonly contextChanged = () => {
    if (this.connection?.context.state !== 'running') this.fail(new Error('STEP_MICROPHONE_CONTEXT_INTERRUPTED'));
  };
  private closed(): boolean { return this.state === 'FAILED' || this.state === 'DISPOSED'; }
  private check(): void { if (this.closed()) throw this.failure ?? new Error('STEP_MICROPHONE_DISPOSED'); }
  private fail(error: unknown): void {
    if (this.closed()) return;
    this.failure = error instanceof Error ? error : new Error(String(error)); this.state = 'FAILED'; this.issued = null;
    this.rejectReady(this.failure); void this.dispose();
    try { this.sink.failure(this.failure); } catch { /* Application notification cannot resurrect resources. */ }
  }
}
