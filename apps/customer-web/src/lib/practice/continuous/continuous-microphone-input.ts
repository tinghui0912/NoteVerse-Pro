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
  private failure: string | null = null;
  private publications = 0;
  private disposal: Promise<void> | null = null;
  private detachWorker: (() => void) | undefined;
  constructor(private readonly platform: ContinuousPlatform, private readonly onFailure: (reason: string) => void) {}
  async acquire(signal: AbortSignal): Promise<void> {
    this.worker = await this.platform.acquireInference(signal);
    if (this.disposed || signal.aborted) await this.worker.dispose();
    this.check(signal);
    this.detachWorker = this.worker.onFailure?.(error => this.recordFailure(error));
  }
  async connect(connection: MicrophoneConnection, signal: AbortSignal): Promise<void> {
    this.context = connection.context;
    const coefficients = await this.platform.coefficients(connection.context.sampleRate); this.check(signal);
    this.runtime = await ContinuousAcousticProjection.create({ sessionDomainId: connection.sessionDomainId,
      sourceDomainId: `${connection.sessionDomainId}:capture`, sourceSampleRateHz: connection.context.sampleRate,
      coefficientBytes: coefficients, worker: { run: input => this.worker!.run(input), dispose: () => this.worker!.dispose() },
      nowAvailabilityMs: () => connection.clock.nowMs(),
      onPublication: publication => { deliverPublication(connection.publish, publication); this.publications++; },
      onFailure: error => this.recordFailure(error) });
    if (this.disposed || signal.aborted) { await this.runtime.dispose(); this.check(signal); }
    this.check(signal);
    this.bridge = new ContinuousCaptureBridge(this.runtime, connection.context.sampleRate);
    const capture = await this.platform.connectCapture({ bridge: this.bridge, stream: connection.stream,
      ownership: 'BORROWED_SESSION_STREAM', context: connection.context, workletUrl: this.platform.workletUrl });
    this.capture = capture;
    if (signal.aborted || this.disposed) { capture.stop(); this.check(signal); }
    await this.wait(() => Boolean(this.runtime?.prerollReady), signal, 15000);
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
  fail(reason: string): void { this.recordFailure(new Error(reason)); }
  private recordFailure(error: Error): void {
    if (this.failure || this.disposed) return;
    this.failure = error.message; this.runtime?.failAnalysis(error); this.onFailure(error.message);
  }
  snapshot() { return Object.freeze({ publications: this.publications,
    failure: this.failure, runtime: this.runtime?.snapshot() ?? null, capture: this.bridge?.snapshot() ?? null }); }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.detachWorker?.(); this.detachWorker = undefined; this.capture?.stop();
    this.disposal = this.runtime ? this.runtime.dispose() : this.worker?.dispose() ?? Promise.resolve();
    return this.disposal;
  }
  private check(signal?: AbortSignal): void {
    if (signal?.aborted || this.disposed) throw new Error('CONTINUOUS_PREPARATION_CANCELLED');
    if (this.failure) throw new Error(this.failure);
  }
  private async wait(ready: () => boolean, signal: AbortSignal, timeout: number): Promise<void> {
    const end = performance.now() + timeout; // Timeout only, never source/transport identity.
    while (!ready()) {
      this.check(signal); if (performance.now() > end) throw new Error('CONTINUOUS_ANALYSIS_TIMEOUT');
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new Error('CONTINUOUS_PREPARATION_CANCELLED')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 5);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
    }
    this.check(signal);
  }
}
