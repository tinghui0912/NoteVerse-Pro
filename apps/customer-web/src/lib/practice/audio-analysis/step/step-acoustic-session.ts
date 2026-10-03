import { PracticeTimebase, type SessionTime } from '../../local-core';
import {
  AcousticEventStreamNormalizer,
} from '../../acoustic-inference/acoustic-event-stream';
import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_INPUT_DESCRIPTOR,
  type AcousticNoteEvent,
  type ByteDanceInferenceResult,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRuntimeExecutionProvider,
} from '../../acoustic-inference/bytedance-contract';
import {
  acousticEventsToStepObservation,
} from '../../acoustic-inference/acoustic-evidence-adapters';
import { createByteDanceBrowserWorkerClient } from '../../acoustic-inference/bytedance-worker-factory';
import type { ByteDanceBrowserWorkerClient } from '../../acoustic-inference/bytedance-worker-protocol';
import {
  monoFromChannels,
  StreamingLinearResampler,
  type NormalizedPcmChunk,
} from '../capture/streaming-resampler';
import type {
  StepVerifierObservation,
  StepVerifierTarget,
} from '../../local-core';

export { monoFromChannels, StreamingLinearResampler } from '../capture/streaming-resampler';
export type { NormalizedPcmChunk } from '../capture/streaming-resampler';

export const STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES = 2400;

const MODEL_SAMPLE_RATE_HZ = BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz;
const FUTURE_SAMPLES = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.futureMs);
const LOOKBACK_SAMPLES = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.lookbackMs);
const TARGET_ANCHOR_SAMPLES = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.targetAnchorMs);
const MODEL_WINDOW_SAMPLES = BYTEDANCE_INPUT_DESCRIPTOR.shape[1];

type StepAcousticSessionStateName =
  | 'idle'
  | 'requesting-permission'
  | 'initializing-audio'
  | 'initializing-model'
  | 'running'
  | 'stopping'
  | 'error'
  | 'disposed';

export type StepAcousticSessionState = {
  state: StepAcousticSessionStateName;
  captureDomainId?: string;
  sourceSampleRateHz?: number;
  captureStartSampleIndex?: number;
  captureAnchorSessionTimeMs?: number;
  normalizedEndSampleIndex: number;
  workletChunkCount?: number;
  sourceContinuityOk?: boolean;
  lastSourceSampleIndex?: number;
  latestSubmittedAnchorSampleIndex?: number;
  activeAnchorSampleIndex?: number;
  coalescedAnchorSampleIndex?: number;
  skippedAnchorCount: number;
  diagnostics?: StepByteDanceDiagnosticsSnapshot;
  lastError?: string;
};

export type StepByteDanceDiagnosticsSnapshot = {
  executionProvider?: ByteDanceRuntimeExecutionProvider;
  providerFallback?: {
    from: ByteDanceRuntimeExecutionProvider;
    error: string;
  };
  inferenceCount: number;
  submittedAnchorCount: number;
  workerTotalMedianMs?: number;
  workerTotalP95Ms?: number;
  lastInferenceWorkerTotalMs?: number;
  latestSubmittedAnchorSampleIndex?: number;
  activeAnchorSampleIndex?: number;
  pendingAnchorSampleIndex?: number;
  captureDurationMs: number;
};

type StepByteDanceEvidenceSink = {
  onAcousticEvents?(events: readonly AcousticNoteEvent[]): void;
  onStepObservation?(observation: StepVerifierObservation): void;
  currentStepTarget?(): StepVerifierTarget | null;
};

export type StepMicrophoneCaptureOptions = {
  manifest: ByteDanceModelManifest;
  sessionTimebase: PracticeTimebase;
  sourceSampleRateHz: number;
  captureDomainId?: string;
  workerClient?: ByteDanceBrowserWorkerClient;
  workerClientFactory?: () => ByteDanceBrowserWorkerClient;
  evidenceSink?: StepByteDanceEvidenceSink;
  ringCapacitySamples?: number;
  nowMs?: () => number;
  captureSessionAnchor?: () => SessionTime;
  onFatalError?: (error: Error) => void;
};

export class BoundedPcmSampleRing {
  private buffer = new Float32Array(0);
  private startIndex = 0;
  private endIndex = 0;

  constructor(readonly capacitySamples: number) {
    if (!Number.isInteger(capacitySamples) || capacitySamples <= 0) {
      throw new Error('PCM ring capacity must be a positive integer.');
    }
  }

  get startSampleIndex(): number {
    return this.startIndex;
  }

  get endSampleIndex(): number {
    return this.endIndex;
  }

  append(samples: Float32Array, startSampleIndex = this.endIndex): void {
    if (startSampleIndex !== this.endIndex) {
      throw new Error('PCM ring append requires contiguous normalized samples.');
    }
    if (samples.length === 0) {
      return;
    }
    const combined = new Float32Array(this.buffer.length + samples.length);
    combined.set(this.buffer);
    combined.set(samples, this.buffer.length);
    this.buffer = combined;
    this.endIndex += samples.length;
    this.trimBefore(Math.max(this.startIndex, this.endIndex - this.capacitySamples));
  }

  hasRange(startSampleIndex: number, endSampleIndex: number): boolean {
    return startSampleIndex >= this.startIndex && endSampleIndex <= this.endIndex;
  }

  extractRange(startSampleIndex: number, endSampleIndex: number): Float32Array {
    if (!this.hasRange(startSampleIndex, endSampleIndex)) {
      throw new Error('Requested PCM range is not present in the bounded ring.');
    }
    return this.buffer
      .subarray(startSampleIndex - this.startIndex, endSampleIndex - this.startIndex)
      .slice();
  }

  trimBefore(sampleIndex: number): void {
    const trimTo = Math.min(Math.max(sampleIndex, this.startIndex), this.endIndex);
    const trim = trimTo - this.startIndex;
    if (trim <= 0) {
      return;
    }
    this.buffer = this.buffer.subarray(trim).slice();
    this.startIndex = trimTo;
  }

  reset(startSampleIndex = 0): void {
    this.buffer = new Float32Array(0);
    this.startIndex = startSampleIndex;
    this.endIndex = startSampleIndex;
  }
}

export type StepFixedAnchorWindow = {
  pcm: Float32Array;
  anchorSampleIndex: number;
  captureStartSampleIndex: number;
  realStartSampleIndex: number;
  realEndSampleIndex: number;
  leftPaddingSamples: number;
};

export function buildStepFixedAnchorWindow(input: {
  ring: BoundedPcmSampleRing;
  anchorSampleIndex: number;
  captureDomainStartSampleIndex?: number;
}): StepFixedAnchorWindow {
  const captureStartSampleIndex = input.anchorSampleIndex - TARGET_ANCHOR_SAMPLES;
  const domainStartSampleIndex = input.captureDomainStartSampleIndex ?? 0;
  if (input.anchorSampleIndex < 0 || !Number.isInteger(input.anchorSampleIndex)) {
    throw new Error('Step fixed-anchor window requires a non-negative integer anchor sample.');
  }
  if (input.ring.endSampleIndex < input.anchorSampleIndex + FUTURE_SAMPLES) {
    throw new Error('Step fixed-anchor window is not ready: missing +220 ms future context.');
  }
  if (input.anchorSampleIndex > input.ring.endSampleIndex) {
    throw new Error('Step fixed-anchor anchor is beyond captured PCM.');
  }
  const availableRealLookback = Math.min(
    LOOKBACK_SAMPLES,
    Math.max(0, input.anchorSampleIndex - domainStartSampleIndex)
  );
  const realStartSampleIndex = input.anchorSampleIndex - availableRealLookback;
  const realEndSampleIndex = input.anchorSampleIndex + FUTURE_SAMPLES;
  if (!input.ring.hasRange(realStartSampleIndex, realEndSampleIndex)) {
    throw new Error('Step fixed-anchor window range is no longer present in the bounded ring.');
  }
  const pcm = new Float32Array(MODEL_WINDOW_SAMPLES);
  const realAudio = input.ring.extractRange(realStartSampleIndex, realEndSampleIndex);
  const leftPaddingSamples = TARGET_ANCHOR_SAMPLES - availableRealLookback;
  pcm.set(realAudio, leftPaddingSamples);
  return {
    pcm,
    anchorSampleIndex: input.anchorSampleIndex,
    captureStartSampleIndex,
    realStartSampleIndex,
    realEndSampleIndex,
    leftPaddingSamples,
  };
}

export class StepInferenceScheduler {
  private activeAnchor: number | null = null;
  private pendingAnchor: number | null = null;
  private lastSubmittedAnchor: number | null = null;
  private minAnchorSampleIndex = 0;
  private skipped = 0;

  constructor(
    readonly anchorStepSamples = STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES,
    readonly futureSamples = FUTURE_SAMPLES
  ) {}

  get activeAnchorSampleIndex(): number | undefined {
    return this.activeAnchor ?? undefined;
  }

  get pendingAnchorSampleIndex(): number | undefined {
    return this.pendingAnchor ?? undefined;
  }

  get skippedAnchorCount(): number {
    return this.skipped;
  }

  nextReadyAnchor(capturedEndSampleIndex: number): number | null {
    const latest = Math.floor((capturedEndSampleIndex - this.futureSamples) / this.anchorStepSamples)
      * this.anchorStepSamples;
    const firstEligible = Math.ceil(this.minAnchorSampleIndex / this.anchorStepSamples) * this.anchorStepSamples;
    if (latest < firstEligible || (this.lastSubmittedAnchor !== null && latest <= this.lastSubmittedAnchor)) {
      return null;
    }
    if (this.activeAnchor !== null) {
      if (this.pendingAnchor !== null && latest > this.pendingAnchor) {
        this.skipped += Math.max(0, Math.floor((latest - this.pendingAnchor) / this.anchorStepSamples));
      }
      this.pendingAnchor = latest;
      return null;
    }
    return latest;
  }

  markStarted(anchorSampleIndex: number): void {
    if (this.activeAnchor !== null) {
      throw new Error('Step inference scheduler already has an active inference.');
    }
    this.activeAnchor = anchorSampleIndex;
    this.lastSubmittedAnchor = anchorSampleIndex;
    if (this.pendingAnchor === anchorSampleIndex) {
      this.pendingAnchor = null;
    }
  }

  markCompleted(): number | null {
    this.activeAnchor = null;
    const next = this.pendingAnchor;
    this.pendingAnchor = null;
    if (next === null || (this.lastSubmittedAnchor !== null && next <= this.lastSubmittedAnchor)) {
      return null;
    }
    return next;
  }

  reset(minAnchorSampleIndex = 0): void {
    this.activeAnchor = null;
    this.pendingAnchor = null;
    this.lastSubmittedAnchor = null;
    this.minAnchorSampleIndex = minAnchorSampleIndex;
    this.skipped = 0;
  }
}

class BoundedNumberRing {
  private readonly buffer: number[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Bounded number ring capacity must be a positive integer.');
    }
  }

  push(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.buffer.push(value);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  reset(): void {
    this.buffer.length = 0;
  }

  values(): readonly number[] {
    return this.buffer;
  }
}

export class StepByteDanceAnalysisPipeline {
  private readonly ring: BoundedPcmSampleRing;
  private readonly scheduler = new StepInferenceScheduler();
  private readonly normalizer = new AcousticEventStreamNormalizer({
    sampleRateHz: MODEL_SAMPLE_RATE_HZ,
  });
  private worker: ByteDanceBrowserWorkerClient | null = null;
  private lifecycleTimebase: PracticeTimebase;
  private lifecycleStartSampleIndex = 0;
  private inferenceCount = 0;
  private submittedAnchorCount = 0;
  private readonly workerTotalMs = new BoundedNumberRing(128);
  private loadExecutionProvider: ByteDanceRuntimeExecutionProvider | undefined;
  private loadExecutionProviderFallback: StepByteDanceDiagnosticsSnapshot['providerFallback'];
  private generation = 0;
  private fixedWorkerConsumed = false;
  private fatalErrorNotified = false;
  private state: StepAcousticSessionState = {
    state: 'idle',
    normalizedEndSampleIndex: 0,
    skippedAnchorCount: 0,
  };

  constructor(private readonly options: StepMicrophoneCaptureOptions) {
    this.lifecycleTimebase = options.sessionTimebase;
    this.ring = new BoundedPcmSampleRing(
      options.ringCapacitySamples ?? defaultStepRingCapacitySamples()
    );
  }

  snapshot(): StepAcousticSessionState {
    return {
      ...this.state,
      diagnostics: this.diagnosticsSnapshot(),
    };
  }

  async start(): Promise<void> {
    this.generation += 1;
    this.fatalErrorNotified = false;
    const worker = this.createWorker();
    const anchor = this.captureAnchorSessionTime();
    const startSampleIndex = sampleIndexForSessionTime(anchor);
    this.worker = worker;
    this.lifecycleTimebase = createStepCaptureTimebase({
      captureDomainId: anchor.domainId,
      anchorSampleIndex: startSampleIndex,
      anchorSessionTime: anchor,
    });
    this.lifecycleStartSampleIndex = startSampleIndex;
    this.normalizer.reset();
    this.ring.reset(startSampleIndex);
    this.scheduler.reset(startSampleIndex);
    this.resetDiagnostics();
    this.state = {
      state: 'initializing-model',
      captureDomainId: anchor.domainId,
      sourceSampleRateHz: this.options.sourceSampleRateHz,
      captureStartSampleIndex: startSampleIndex,
      captureAnchorSessionTimeMs: anchor.ms,
      normalizedEndSampleIndex: startSampleIndex,
      skippedAnchorCount: 0,
    };
    try {
      const loadDiagnostics = await worker.load(this.options.manifest);
      this.loadExecutionProvider = loadDiagnostics?.executionProvider;
      this.loadExecutionProviderFallback = loadDiagnostics?.executionProviderFallback;
      this.state = {
        ...this.state,
        state: 'running',
      };
    } catch (error) {
      await this.failLifecycle(error);
      throw error;
    }
  }

  get currentLifecycleStartSampleIndex(): number {
    return this.lifecycleStartSampleIndex;
  }

  appendNormalizedPcm(samples: Float32Array, startSampleIndex = this.ring.endSampleIndex): void {
    this.assertRunning();
    this.ring.append(samples, startSampleIndex);
    this.state = {
      ...this.state,
      normalizedEndSampleIndex: this.ring.endSampleIndex,
    };
    const ready = this.scheduler.nextReadyAnchor(this.ring.endSampleIndex);
    this.state = {
      ...this.state,
      coalescedAnchorSampleIndex: this.scheduler.pendingAnchorSampleIndex,
      skippedAnchorCount: this.scheduler.skippedAnchorCount,
    };
    if (ready !== null) {
      void this.submitAnchor(ready);
    }
  }

  async stop(): Promise<void> {
    if (this.state.state === 'disposed') {
      return;
    }
    this.generation += 1;
    this.state = { ...this.state, state: 'stopping' };
    await this.cleanupResources('Live capture stopped while ByteDance inference was active.');
    this.state = {
      state: 'idle',
      normalizedEndSampleIndex: 0,
      skippedAnchorCount: 0,
    };
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.state = { ...this.state, state: 'disposed' };
  }

  private async submitAnchor(anchorSampleIndex: number): Promise<void> {
    const generation = this.generation;
    this.scheduler.markStarted(anchorSampleIndex);
    this.submittedAnchorCount += 1;
    this.state = {
      ...this.state,
      activeAnchorSampleIndex: anchorSampleIndex,
      latestSubmittedAnchorSampleIndex: anchorSampleIndex,
      coalescedAnchorSampleIndex: this.scheduler.pendingAnchorSampleIndex,
      skippedAnchorCount: this.scheduler.skippedAnchorCount,
    };
    try {
      const window = buildStepFixedAnchorWindow({
        ring: this.ring,
        anchorSampleIndex,
        captureDomainStartSampleIndex: this.lifecycleStartSampleIndex,
      });
      const request = this.requestForWindow(window);
      const result = await this.requireWorker().infer(request);
      if (generation !== this.generation) {
        return;
      }
      this.recordInferenceDiagnostics(result);
      this.emitResult(result);
    } catch (error) {
      if (generation === this.generation) {
        await this.failLifecycle(error);
      }
    } finally {
      if (generation === this.generation && this.state.state !== 'error') {
        const next = this.scheduler.markCompleted();
        this.state = {
          ...this.state,
          activeAnchorSampleIndex: this.scheduler.activeAnchorSampleIndex,
          coalescedAnchorSampleIndex: this.scheduler.pendingAnchorSampleIndex,
          skippedAnchorCount: this.scheduler.skippedAnchorCount,
        };
        if (next !== null) {
          void this.submitAnchor(next);
        }
      }
    }
  }

  private requestForWindow(window: StepFixedAnchorWindow): ByteDancePcmInferenceRequest {
    const captureStartTime = this.lifecycleTimebase.sampleIndexToSessionTime(
      window.captureStartSampleIndex
    );
    return {
      requestId: `live-bytedance:${this.generation}:${window.anchorSampleIndex}`,
      pcm: window.pcm,
      sampleRateHz: MODEL_SAMPLE_RATE_HZ,
      channelCount: 1,
      captureStartSampleIndex: window.captureStartSampleIndex,
      captureStartTime,
      inferenceRequestedAtMs: this.options.nowMs?.() ?? globalThis.performance?.now?.(),
    };
  }

  private diagnosticsSnapshot(): StepByteDanceDiagnosticsSnapshot {
    const captureDurationMs = Math.max(
      0,
      (this.ring.endSampleIndex - this.lifecycleStartSampleIndex) / MODEL_SAMPLE_RATE_HZ * 1000
    );
    const workerTotals = this.workerTotalMs.values();
    return {
      executionProvider: this.loadExecutionProvider,
      providerFallback: this.loadExecutionProviderFallback,
      inferenceCount: this.inferenceCount,
      submittedAnchorCount: this.submittedAnchorCount,
      workerTotalMedianMs: percentile(workerTotals, 0.5),
      workerTotalP95Ms: percentile(workerTotals, 0.95),
      lastInferenceWorkerTotalMs: workerTotals[workerTotals.length - 1],
      latestSubmittedAnchorSampleIndex: this.state.latestSubmittedAnchorSampleIndex,
      activeAnchorSampleIndex: this.scheduler.activeAnchorSampleIndex,
      pendingAnchorSampleIndex: this.scheduler.pendingAnchorSampleIndex,
      captureDurationMs,
    };
  }

  private recordInferenceDiagnostics(result: ByteDanceInferenceResult): void {
    this.inferenceCount += 1;
    const workerTotal = result.diagnostics?.timingMs.workerTotal;
    if (typeof workerTotal === 'number' && Number.isFinite(workerTotal)) {
      this.workerTotalMs.push(workerTotal);
    }
  }

  private resetDiagnostics(): void {
    this.inferenceCount = 0;
    this.submittedAnchorCount = 0;
    this.workerTotalMs.reset();
    this.loadExecutionProvider = undefined;
    this.loadExecutionProviderFallback = undefined;
  }

  private emitResult(result: ByteDanceInferenceResult): void {
    const events = this.normalizer.normalizeWindow(result.events);
    if (events.length === 0) {
      return;
    }
    this.options.evidenceSink?.onAcousticEvents?.(events);
    const target = this.options.evidenceSink?.currentStepTarget?.() ?? null;
    if (target) {
      const observation = acousticEventsToStepObservation(target, events);
      if (observation) {
        this.options.evidenceSink?.onStepObservation?.(observation);
      }
    }
  }

  private assertRunning(): void {
    if (this.state.state !== 'running') {
      throw new Error('Step ByteDance pipeline is not running.');
    }
  }

  private createWorker(): ByteDanceBrowserWorkerClient {
    if (this.options.workerClient) {
      if (this.fixedWorkerConsumed) {
        throw new Error('A fixed ByteDance workerClient can only be used for one capture lifecycle; use workerClientFactory for restartable capture.');
      }
      this.fixedWorkerConsumed = true;
      return this.options.workerClient;
    }
    return this.options.workerClientFactory?.() ?? createByteDanceBrowserWorkerClient();
  }

  private requireWorker(): ByteDanceBrowserWorkerClient {
    if (!this.worker) {
      throw new Error('Step ByteDance pipeline has no active Worker client.');
    }
    return this.worker;
  }

  private captureAnchorSessionTime(): SessionTime {
    const explicit = this.options.captureSessionAnchor?.();
    if (explicit) {
      return explicit;
    }
    const runtimeNow = this.options.nowMs?.() ?? globalThis.performance?.now?.() ?? 0;
    return this.options.sessionTimebase.runtimeToSessionTime(runtimeNow);
  }

  private async failLifecycle(error: unknown): Promise<void> {
    this.generation += 1;
    const fatalError = error instanceof Error ? error : new Error(String(error));
    await this.cleanupResources('Live capture failed; ByteDance Worker was terminated.');
    this.state = {
      ...this.state,
      state: 'error',
      lastError: fatalError.message,
    };
    this.notifyFatalError(fatalError);
  }

  private async cleanupResources(activeInferenceReason: string): Promise<void> {
    this.scheduler.reset();
    this.normalizer.reset();
    this.ring.reset(this.lifecycleStartSampleIndex);
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return;
    }
    try {
      await worker.dispose();
    } catch (error) {
      if (typeof worker.terminate === 'function') {
        worker.terminate(activeInferenceReason);
      } else if (!String(error instanceof Error ? error.message : error).includes('active inference')) {
        throw error;
      }
    }
  }

  private notifyFatalError(error: Error): void {
    if (this.fatalErrorNotified) {
      return;
    }
    this.fatalErrorNotified = true;
    this.options.onFatalError?.(error);
  }
}
/**
 * Lifecycle contract:
 *
 * start()
 *   - only valid when idle/error
 *   - creates one BrowserCaptureLifecycle
 *   - stale/cancelled startup can never publish running
 *
 * stop()
 *   - invalidates current startup/runtime immediately
 *   - eventually releases all lifecycle-owned resources
 *   - resolves with state idle
 *
 * fatal
 *   - invalidates its own lifecycle
 *   - releases only its own resources
 *   - final state error unless superseded by explicit stop/newer lifecycle
 *
 * retry start()
 *   - only begins after old resource ownership is safely detached
 */
type BrowserCaptureLifecycle = {
  readonly generation: number;
  cancelled: boolean;
  stoppedByStop: boolean;

  mediaStream: MediaStream | null;
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  sinkNode: GainNode | null;

  resampler: StreamingLinearResampler | null;
  pipeline: StepByteDanceAnalysisPipeline | null;

  workletChunkCount: number;
  sourceContinuityOk: boolean;
  expectedSourceSampleIndex: number;
};

function releaseLifecycleResources(lc: BrowserCaptureLifecycle): Promise<void> {
  lc.workletNode?.port.close();
  lc.workletNode?.disconnect();
  lc.sinkNode?.disconnect();
  lc.sourceNode?.disconnect();
  for (const track of lc.mediaStream?.getTracks() ?? []) {
    track.stop();
  }
  const audioClosePromise = lc.audioContext?.close().catch(() => undefined) ?? Promise.resolve();
  const pipelineStopPromise = lc.pipeline?.stop().catch(() => undefined) ?? Promise.resolve();
  lc.mediaStream = null;
  lc.audioContext = null;
  lc.sourceNode = null;
  lc.workletNode = null;
  lc.sinkNode = null;
  lc.resampler = null;
  lc.pipeline = null;
  return Promise.all([audioClosePromise, pipelineStopPromise]).then(() => undefined);
}

export class StepMicrophoneCaptureController {
  private generation = 0;
  private currentLifecycle: BrowserCaptureLifecycle | null = null;
  private state: StepAcousticSessionState = {
    state: 'idle',
    normalizedEndSampleIndex: 0,
    skippedAnchorCount: 0,
  };

  constructor(private readonly options: StepMicrophoneCaptureOptions) {
  }

  snapshot(): StepAcousticSessionState {
    const lc = this.currentLifecycle;
    return {
      ...this.state,
      ...(lc?.pipeline?.snapshot() ?? {}),
      workletChunkCount: lc?.workletChunkCount ?? 0,
      sourceContinuityOk: lc?.sourceContinuityOk ?? true,
      lastSourceSampleIndex: lc?.expectedSourceSampleIndex ?? 0,
    };
  }

  get mediaStream(): MediaStream | null {
    return this.currentLifecycle?.mediaStream ?? null;
  }

  async start(): Promise<void> {
    const currentState = this.state.state;
    if (
      currentState === 'running' ||
      currentState === 'requesting-permission' ||
      currentState === 'initializing-audio' ||
      currentState === 'initializing-model' ||
      currentState === 'stopping'
    ) {
      throw new Error(
        `Cannot start capture: controller is already in '${currentState}' state.`
      );
    }
    this.generation += 1;
    const lc: BrowserCaptureLifecycle = {
      generation: this.generation,
      cancelled: false,
      stoppedByStop: false,
      mediaStream: null,
      audioContext: null,
      sourceNode: null,
      workletNode: null,
      sinkNode: null,
      resampler: null,
      pipeline: null,
      workletChunkCount: 0,
      sourceContinuityOk: true,
      expectedSourceSampleIndex: 0,
    };
    this.currentLifecycle = lc;
    this.state = { ...this.state, state: 'requesting-permission' };
    try {
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error('Browser microphone capture requires getUserMedia.');
      }
      lc.mediaStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (lc.cancelled) {
        void releaseLifecycleResources(lc);
        return;
      }

      this.state = { ...this.state, state: 'initializing-audio' };
      lc.audioContext = new AudioContext();
      await lc.audioContext.audioWorklet.addModule(
        new URL('../../acoustic-inference/bytedance-capture.worklet.js', import.meta.url)
      );
      if (lc.cancelled) {
        void releaseLifecycleResources(lc);
        return;
      }

      this.state = { ...this.state, state: 'initializing-model' };
      lc.pipeline = new StepByteDanceAnalysisPipeline({
        ...this.options,
        sourceSampleRateHz: lc.audioContext.sampleRate,
        onFatalError: (error) => {
          if (this.currentLifecycle !== lc || lc.cancelled) {
            return;
          }
          this.handleFatalError(error, lc);
        },
      });
      await lc.pipeline.start();
      if (lc.cancelled) {
        void releaseLifecycleResources(lc);
        return;
      }

      lc.resampler = new StreamingLinearResampler(
        lc.audioContext.sampleRate,
        MODEL_SAMPLE_RATE_HZ,
        lc.pipeline.currentLifecycleStartSampleIndex
      );
      lc.workletNode = new AudioWorkletNode(lc.audioContext, 'noteverse-bytedance-capture');
      lc.workletNode.addEventListener('processorerror', (event) => {
        if (this.currentLifecycle !== lc || lc.cancelled) {
          return;
        }
        this.handleFatalError(
          new Error(`AudioWorklet processor failed: ${event.type}`),
          lc
        );
      });
      lc.workletNode.port.onmessage = (event: MessageEvent<WorkletPcmChunkMessage>) => {
        if (this.currentLifecycle !== lc || lc.cancelled) {
          return;
        }
        try {
          if (event.data.type !== 'pcm-chunk' || !lc.resampler || !lc.pipeline) {
            return;
          }
          lc.workletChunkCount += 1;
          if (event.data.sourceStartSampleIndex !== lc.expectedSourceSampleIndex) {
            lc.sourceContinuityOk = false;
          }
          lc.expectedSourceSampleIndex = event.data.sourceEndSampleIndex;
          const chunk = lc.resampler.append({
            samples: event.data.samples,
            sourceStartSampleIndex: event.data.sourceStartSampleIndex,
          });
          lc.pipeline.appendNormalizedPcm(chunk.samples, chunk.startSampleIndex);
        } catch (error) {
          this.handleFatalError(error, lc);
        }
      };
      lc.sourceNode = lc.audioContext.createMediaStreamSource(lc.mediaStream);
      lc.sinkNode = lc.audioContext.createGain();
      lc.sinkNode.gain.value = 0;
      lc.sourceNode.connect(lc.workletNode);
      lc.workletNode.connect(lc.sinkNode);
      lc.sinkNode.connect(lc.audioContext.destination);
      this.state = {
        ...lc.pipeline.snapshot(),
        state: 'running',
        sourceSampleRateHz: lc.audioContext.sampleRate,
      };
    } catch (error) {
      if (!lc.stoppedByStop) {
        this.state = {
          ...this.state,
          state: 'error',
          lastError: error instanceof Error ? error.message : String(error),
        };
        if (this.currentLifecycle === lc) {
          this.currentLifecycle = null;
        }
      }
      await releaseLifecycleResources(lc);
      if (!lc.stoppedByStop) {
        throw error;
      }
    }
  }

  async stop(): Promise<void> {
    const currentState = this.state.state;
    if (currentState === 'idle') {
      return;
    }
    this.generation += 1;
    const lc = this.currentLifecycle;
    this.currentLifecycle = null;
    this.state = {
      ...this.state,
      state: 'stopping',
    };
    if (lc) {
      lc.cancelled = true;
      lc.stoppedByStop = true;
      await releaseLifecycleResources(lc);
    }
    this.state = {
      state: 'idle',
      normalizedEndSampleIndex: 0,
      skippedAnchorCount: 0,
    };
  }

  private handleFatalError(error: unknown, lc: BrowserCaptureLifecycle): void {
    if (this.currentLifecycle !== lc || lc.cancelled) {
      return;
    }
    const fatalError = error instanceof Error ? error : new Error(String(error));
    this.generation += 1;
    lc.cancelled = true;
    this.currentLifecycle = null;
    this.state = {
      ...this.state,
      state: 'error',
      lastError: fatalError.message,
    };
    void releaseLifecycleResources(lc);
  }
}

type WorkletPcmChunkMessage = {
  type: 'pcm-chunk';
  sourceSampleRateHz: number;
  sourceStartSampleIndex: number;
  sourceEndSampleIndex: number;
  samples: Float32Array;
};

function defaultStepRingCapacitySamples(): number {
  return MODEL_WINDOW_SAMPLES
    + STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES * 4
    + FUTURE_SAMPLES;
}

export function createStepCaptureTimebase(input: {
  captureDomainId: string;
  anchorSampleIndex?: number;
  anchorSessionTime?: SessionTime;
}): PracticeTimebase {
  return new PracticeTimebase({
    domainId: input.captureDomainId,
    sampleRateHz: MODEL_SAMPLE_RATE_HZ,
    anchorSampleIndex: input.anchorSampleIndex ?? 0,
    anchorSessionTimeMs: input.anchorSessionTime?.ms ?? 0,
  });
}

function sampleIndexForSessionTime(time: SessionTime): number {
  if (time.sampleIndex !== undefined) {
    return time.sampleIndex;
  }
  if (!Number.isFinite(time.ms) || time.ms < 0) {
    throw new Error('Capture session anchor must have finite non-negative session time.');
  }
  return Math.round(time.ms / 1000 * MODEL_SAMPLE_RATE_HZ);
}

function millisecondsToSamples(milliseconds: number): number {
  return Math.round(milliseconds / 1000 * MODEL_SAMPLE_RATE_HZ);
}

function percentile(values: readonly number[], quantile: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(quantile * ordered.length) - 1)
  );
  return ordered[index];
}
