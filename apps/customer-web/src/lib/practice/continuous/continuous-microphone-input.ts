import { acousticBoundaryFailure } from '@/lib/practice/acoustic/failure-boundary';
import { InferenceFailure } from '@/lib/practice/failure/causal-failure';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { ContinuousAcousticProjection } from '@/lib/practice/acoustic/continuous/continuous-projection';
import { ContinuousCaptureBridge } from '@/lib/practice/acoustic/continuous/capture-bridge';
import { deliverPublication } from '@/lib/practice/acoustic/continuous/publication';
import type { ContinuousPlatform, MicrophoneConnection } from './continuous-input';

export class ContinuousMicrophoneInput {
  private worker: AcousticInferencePort | null = null;
  private runtime: ContinuousAcousticProjection | null = null;
  private bridge: ContinuousCaptureBridge | null = null;
  private capture: { stop(): void } | null = null;
  private context: AudioContext | null = null;
  private disposed = false;
  private failure: Error | null = null;
  private publications = 0;
  private disposal: Promise<void> | null = null;
  private detachWorker: (() => void) | undefined;
  private readonly readinessWaits = new Set<() => void>();
  constructor(private readonly platform: ContinuousPlatform, private readonly onFailure: (failure: Error) => void, private readonly startup = new PracticeStartupTimings()) {}
  async acquire(signal: AbortSignal): Promise<void> {
    this.worker = await this.platform.acquireInference(signal);
    if (this.disposed || signal.aborted) await this.worker.dispose();
    this.check(signal);
    this.detachWorker = this.worker.onFailure?.(error => this.recordFailure(error));
  }
  async connect(connection: MicrophoneConnection, signal: AbortSignal): Promise<void> {
    this.context = connection.context;
    const coefficients = await this.startup.measure('firLoad', () => this.platform.coefficients(connection.context.sampleRate)); this.check(signal);
    this.runtime = await ContinuousAcousticProjection.create({ sessionDomainId: connection.sessionDomainId,
      sourceDomainId: `${connection.sessionDomainId}:capture`, sourceSampleRateHz: connection.context.sampleRate,
      coefficientBytes: coefficients, worker: { run: input => this.worker!.run(input), dispose: () => this.worker!.dispose() },
      // AudioContextPerformanceClock shares the established Continuous session coordinate.
      nowAvailabilityRuntimeMs: () => connection.clock.nowMs(),
      onPublication: publication => { if (this.disposed || this.failure) return; deliverPublication(connection.publish, publication); this.publications++; },
      onFailure: error => this.recordFailure(error) }).catch(cause => { throw acousticBoundaryFailure(cause); });
    if (this.disposed || signal.aborted) { await this.runtime.dispose(); this.check(signal); }
    this.check(signal);
    this.bridge = new ContinuousCaptureBridge(this.runtime, connection.context.sampleRate);
    const capture = await this.startup.measure('captureConnect', () => this.platform.connectCapture({ bridge: this.bridge!, stream: connection.stream,
      ownership: 'BORROWED_SESSION_STREAM', contextInterruption: 'RETAIN_GRAPH', context: connection.context, workletUrl: this.platform.workletUrl }));
    this.capture = capture;
    if (signal.aborted || this.disposed) { capture.stop(); this.check(signal); }
    await this.startup.measure('acousticPreroll', () => this.wait(() => Boolean(this.runtime?.prerollReady), signal, 15000));
  }
  boundary(type: 'BEGIN' | 'PAUSE' | 'TERMINAL', contextTime: number, performanceTimeMs: number): string {
    this.check();
    const snapshot = this.bridge!.snapshot(), origin = snapshot.audioContextOriginFrame;
    if (origin === null) throw new Error('ACOUSTIC_PREROLL_NOT_READY');
    const sourceSampleIndex = Math.round(contextTime * this.context!.sampleRate) - origin;
    return this.bridge!.schedule({ type, sourceSampleIndex, performanceTimeMs });
  }
  assertBoundary(contextTime: number): void {
    this.check(); const snapshot = this.bridge!.snapshot();
    if (snapshot.audioContextOriginFrame === null || Math.round(contextTime * this.context!.sampleRate)
      - snapshot.audioContextOriginFrame < snapshot.nextSourceSampleIndex) throw new Error('CAPTURE_BOUNDARY_ALREADY_CONSUMED');
  }
  cancelPending(id: string | null): void {
    if (id && !this.failure && this.bridge?.isPending(id)) this.bridge.cancel(id);
  }
  get hasRunningSegment(): boolean { return this.runtime?.snapshot().state === 'RUNNING'; }
  async finish(signal: AbortSignal): Promise<void> {
    await this.wait(() => Boolean(this.runtime?.tailReady), signal, 60000);
    this.capture?.stop(); await this.runtime!.seal(); this.check(signal);
  }
  fail(failure: Error): void { this.recordFailure(failure); }
  private recordFailure(error: Error): void {
    if (this.failure || this.disposed) return;
    this.failure = acousticBoundaryFailure(error); this.runtime?.failAnalysis(error);
    for (const observe of this.readinessWaits) observe();
    this.onFailure(this.failure);
  }
  snapshot() { return Object.freeze({ publications: this.publications,
    failure: this.failure?.message ?? null, runtime: this.runtime?.snapshot() ?? null, capture: this.bridge?.snapshot() ?? null }); }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    for (const observe of this.readinessWaits) observe();
    this.detachWorker?.(); this.detachWorker = undefined; this.capture?.stop();
    this.disposal = this.runtime ? this.runtime.dispose() : this.worker?.dispose() ?? Promise.resolve();
    return this.disposal;
  }
  private check(signal?: AbortSignal): void {
    if (signal?.aborted || this.disposed) throw new Error('CONTINUOUS_PREPARATION_CANCELLED');
    if (this.failure) throw this.failure;
  }
  private async wait(ready: () => boolean, signal: AbortSignal, timeout: number): Promise<void> {
    this.check(signal); if (ready()) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false, detach = () => {};
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; detach(); signal.removeEventListener('abort', observe); this.readinessWaits.delete(observe);
        if (timer !== null) clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      // Resolving a Promise observes readiness without reentering application transport.
      const observe = () => {
        if (settled) return;
        try { this.check(signal); if (ready()) finish(); } catch (error) { finish(error); }
      };
      this.readinessWaits.add(observe); signal.addEventListener('abort', observe, { once: true });
      detach = this.bridge!.subscribeReadiness(observe);
      if (settled) detach(); // Also safe if subscription observes an already committed transition.
      observe(); // Snapshot -> subscribe -> recheck; no missed readiness/failure/cancellation.
      if (!settled) timer = setTimeout(() => {
        observe(); // Readiness committed before delayed timer delivery wins over timeout.
        if (!settled) finish(new InferenceFailure('RUNTIME_FAILED'));
      }, timeout);
    });
    this.check(signal);
  }
}
