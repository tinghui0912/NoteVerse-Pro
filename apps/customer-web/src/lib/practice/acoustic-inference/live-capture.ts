import { PracticeTimebase, type SessionTime } from '../local-core';
import {
  AcousticEventStreamNormalizer,
} from './acoustic-event-stream';
import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_INPUT_DESCRIPTOR,
  type AcousticNoteEvent,
  type ByteDanceInferenceResult,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
} from './bytedance-contract';
import {
  acousticEventsToPerformanceEvidence,
  acousticEventsToStepObservation,
} from './acoustic-evidence-adapters';
import { createByteDanceBrowserWorkerClient } from './bytedance-worker-factory';
import type { ByteDanceBrowserWorkerClient } from './bytedance-worker-protocol';
import type {
  PerformanceEvidenceObservation,
  StepVerifierObservation,
  StepVerifierTarget,
} from '../local-core';

export const BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES = 2400;

const MODEL_SAMPLE_RATE_HZ = BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz;
const FUTURE_SAMPLES = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.futureMs);
const TARGET_ANCHOR_SAMPLES = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.targetAnchorMs);
const MODEL_WINDOW_SAMPLES = BYTEDANCE_INPUT_DESCRIPTOR.shape[1];

export type LiveCaptureDomain = {
  captureDomainId: string;
  sourceSampleRateHz: number;
  modelSampleRateHz: typeof MODEL_SAMPLE_RATE_HZ;
  timebase: PracticeTimebase;
};

export type LiveCaptureStateName =
  | 'idle'
  | 'requesting-permission'
  | 'initializing-audio'
  | 'initializing-model'
  | 'running'
  | 'stopping'
  | 'error'
  | 'disposed';

export type LiveCaptureState = {
  state: LiveCaptureStateName;
  captureDomainId?: string;
  sourceSampleRateHz?: number;
  normalizedEndSampleIndex: number;
  latestSubmittedAnchorSampleIndex?: number;
  activeAnchorSampleIndex?: number;
  coalescedAnchorSampleIndex?: number;
  skippedAnchorCount: number;
  lastError?: string;
};

export type LiveByteDanceEvidenceSink = {
  onAcousticEvents?(events: readonly AcousticNoteEvent[]): void;
  onStepObservation?(observation: StepVerifierObservation): void;
  onPerformanceEvidence?(observations: readonly PerformanceEvidenceObservation[]): void;
  currentStepTarget?(): StepVerifierTarget | null;
};

export type LiveByteDanceControllerOptions = {
  manifest: ByteDanceModelManifest;
  sessionTimebase: PracticeTimebase;
  sourceSampleRateHz: number;
  captureDomainId?: string;
  workerClient?: ByteDanceBrowserWorkerClient;
  workerClientFactory?: () => ByteDanceBrowserWorkerClient;
  evidenceSink?: LiveByteDanceEvidenceSink;
  ringCapacitySamples?: number;
  nowMs?: () => number;
};

export class StreamingLinearResampler {
  private sourceBuffer = new Float32Array(0);
  private sourceBufferStart = 0;
  private nextSourceSamplePosition: number | null = null;
  private nextOutputSampleIndex = 0;
  private expectedSourceSampleIndex: number | null = null;

  constructor(
    readonly sourceSampleRateHz: number,
    readonly targetSampleRateHz = MODEL_SAMPLE_RATE_HZ
  ) {
    if (sourceSampleRateHz <= 0 || targetSampleRateHz <= 0) {
      throw new Error('Streaming resampler requires positive source and target sample rates.');
    }
  }

  append(input: { samples: Float32Array; sourceStartSampleIndex: number }): NormalizedPcmChunk {
    if (!Number.isInteger(input.sourceStartSampleIndex) || input.sourceStartSampleIndex < 0) {
      throw new Error('Source sample start must be a non-negative integer.');
    }
    if (this.expectedSourceSampleIndex !== null
      && input.sourceStartSampleIndex !== this.expectedSourceSampleIndex) {
      throw new Error('Streaming resampler requires contiguous source samples.');
    }
    if (this.nextSourceSamplePosition === null) {
      this.nextSourceSamplePosition = input.sourceStartSampleIndex;
      this.sourceBufferStart = input.sourceStartSampleIndex;
    }
    this.expectedSourceSampleIndex = input.sourceStartSampleIndex + input.samples.length;
    this.appendSource(input.samples);
    const output: number[] = [];
    const step = this.sourceSampleRateHz / this.targetSampleRateHz;
    const availableEnd = this.sourceBufferStart + this.sourceBuffer.length;
    while (this.nextSourceSamplePosition + 1 < availableEnd) {
      output.push(this.interpolate(this.nextSourceSamplePosition));
      this.nextSourceSamplePosition += step;
    }
    this.trimSource();
    const startSampleIndex = this.nextOutputSampleIndex;
    this.nextOutputSampleIndex += output.length;
    return {
      samples: Float32Array.from(output),
      startSampleIndex,
      endSampleIndex: this.nextOutputSampleIndex,
    };
  }

  private appendSource(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }
    const combined = new Float32Array(this.sourceBuffer.length + samples.length);
    combined.set(this.sourceBuffer);
    combined.set(samples, this.sourceBuffer.length);
    this.sourceBuffer = combined;
  }

  private interpolate(sourcePosition: number): number {
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = leftIndex + 1;
    const fraction = sourcePosition - leftIndex;
    const left = this.sourceBuffer[leftIndex - this.sourceBufferStart] ?? 0;
    const right = this.sourceBuffer[rightIndex - this.sourceBufferStart] ?? left;
    return left + (right - left) * fraction;
  }

  private trimSource(): void {
    if (this.nextSourceSamplePosition === null) {
      return;
    }
    const keepFrom = Math.max(this.sourceBufferStart, Math.floor(this.nextSourceSamplePosition) - 1);
    const trim = keepFrom - this.sourceBufferStart;
    if (trim <= 0) {
      return;
    }
    this.sourceBuffer = this.sourceBuffer.subarray(trim).slice();
    this.sourceBufferStart = keepFrom;
  }
}

export type NormalizedPcmChunk = {
  samples: Float32Array;
  startSampleIndex: number;
  endSampleIndex: number;
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

  reset(): void {
    this.buffer = new Float32Array(0);
    this.startIndex = 0;
    this.endIndex = 0;
  }
}

export type LiveFixedAnchorWindow = {
  pcm: Float32Array;
  anchorSampleIndex: number;
  captureStartSampleIndex: number;
  realStartSampleIndex: number;
  realEndSampleIndex: number;
  leftPaddingSamples: number;
};

export function buildLiveFixedAnchorWindow(input: {
  ring: BoundedPcmSampleRing;
  anchorSampleIndex: number;
}): LiveFixedAnchorWindow {
  const captureStartSampleIndex = input.anchorSampleIndex - TARGET_ANCHOR_SAMPLES;
  const requiredEndSampleIndex = captureStartSampleIndex + MODEL_WINDOW_SAMPLES;
  if (input.anchorSampleIndex < 0 || !Number.isInteger(input.anchorSampleIndex)) {
    throw new Error('Live fixed-anchor window requires a non-negative integer anchor sample.');
  }
  if (input.ring.endSampleIndex < input.anchorSampleIndex + FUTURE_SAMPLES) {
    throw new Error('Live fixed-anchor window is not ready: missing +220 ms future context.');
  }
  if (input.anchorSampleIndex > input.ring.endSampleIndex) {
    throw new Error('Live fixed-anchor anchor is beyond captured PCM.');
  }
  const realStartSampleIndex = Math.max(0, captureStartSampleIndex);
  const realEndSampleIndex = requiredEndSampleIndex;
  if (!input.ring.hasRange(realStartSampleIndex, realEndSampleIndex)) {
    throw new Error('Live fixed-anchor window range is no longer present in the bounded ring.');
  }
  const pcm = new Float32Array(MODEL_WINDOW_SAMPLES);
  const realAudio = input.ring.extractRange(realStartSampleIndex, realEndSampleIndex);
  const leftPaddingSamples = realStartSampleIndex - captureStartSampleIndex;
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

export class RollingInferenceScheduler {
  private activeAnchor: number | null = null;
  private pendingAnchor: number | null = null;
  private lastSubmittedAnchor: number | null = null;
  private skipped = 0;

  constructor(
    readonly anchorStepSamples = BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES,
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
    if (latest < 0 || (this.lastSubmittedAnchor !== null && latest <= this.lastSubmittedAnchor)) {
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
      throw new Error('Rolling scheduler already has an active inference.');
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

  reset(): void {
    this.activeAnchor = null;
    this.pendingAnchor = null;
    this.lastSubmittedAnchor = null;
    this.skipped = 0;
  }
}

export class LiveByteDanceRollingPipeline {
  private readonly worker: ByteDanceBrowserWorkerClient;
  private readonly ring: BoundedPcmSampleRing;
  private readonly scheduler = new RollingInferenceScheduler();
  private readonly normalizer = new AcousticEventStreamNormalizer({
    sampleRateHz: MODEL_SAMPLE_RATE_HZ,
  });
  private generation = 0;
  private state: LiveCaptureState = {
    state: 'idle',
    normalizedEndSampleIndex: 0,
    skippedAnchorCount: 0,
  };

  constructor(private readonly options: LiveByteDanceControllerOptions) {
    this.worker = options.workerClient ?? options.workerClientFactory?.() ?? createByteDanceBrowserWorkerClient();
    this.ring = new BoundedPcmSampleRing(
      options.ringCapacitySamples ?? defaultLiveRingCapacitySamples()
    );
  }

  snapshot(): LiveCaptureState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    this.generation += 1;
    this.normalizer.reset();
    this.ring.reset();
    this.scheduler.reset();
    this.state = {
      state: 'initializing-model',
      captureDomainId: this.options.captureDomainId,
      sourceSampleRateHz: this.options.sourceSampleRateHz,
      normalizedEndSampleIndex: 0,
      skippedAnchorCount: 0,
    };
    await this.worker.load(this.options.manifest);
    this.state = {
      ...this.state,
      state: 'running',
    };
  }

  appendNormalizedPcm(samples: Float32Array, startSampleIndex = this.ring.endSampleIndex): void {
    this.assertRunning();
    this.ring.append(samples, startSampleIndex);
    this.state = {
      ...this.state,
      normalizedEndSampleIndex: this.ring.endSampleIndex,
    };
    const ready = this.scheduler.nextReadyAnchor(this.ring.endSampleIndex);
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
    this.scheduler.reset();
    this.normalizer.reset();
    this.ring.reset();
    try {
      await this.worker.dispose();
    } catch (error) {
      if (typeof this.worker.terminate === 'function') {
        this.worker.terminate('Live capture stopped while ByteDance inference was active.');
      } else if (!String(error instanceof Error ? error.message : error).includes('active inference')) {
        throw error;
      }
    } finally {
      this.state = {
        state: 'idle',
        normalizedEndSampleIndex: 0,
        skippedAnchorCount: 0,
      };
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.state = { ...this.state, state: 'disposed' };
  }

  private async submitAnchor(anchorSampleIndex: number): Promise<void> {
    const generation = this.generation;
    this.scheduler.markStarted(anchorSampleIndex);
    this.state = {
      ...this.state,
      activeAnchorSampleIndex: anchorSampleIndex,
      latestSubmittedAnchorSampleIndex: anchorSampleIndex,
      coalescedAnchorSampleIndex: this.scheduler.pendingAnchorSampleIndex,
      skippedAnchorCount: this.scheduler.skippedAnchorCount,
    };
    try {
      const window = buildLiveFixedAnchorWindow({ ring: this.ring, anchorSampleIndex });
      const request = this.requestForWindow(window);
      const result = await this.worker.infer(request);
      if (generation !== this.generation) {
        return;
      }
      this.emitResult(result);
    } catch (error) {
      if (generation === this.generation) {
        this.state = {
          ...this.state,
          state: 'error',
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
    } finally {
      if (generation === this.generation) {
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

  private requestForWindow(window: LiveFixedAnchorWindow): ByteDancePcmInferenceRequest {
    const captureStartTime = this.options.sessionTimebase.sampleIndexToSessionTime(
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
    const performanceEvidence = acousticEventsToPerformanceEvidence(events);
    if (performanceEvidence.length > 0) {
      this.options.evidenceSink?.onPerformanceEvidence?.(performanceEvidence);
    }
  }

  private assertRunning(): void {
    if (this.state.state !== 'running') {
      throw new Error('Live ByteDance pipeline is not running.');
    }
  }
}

export class BrowserMicrophoneCaptureController {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private resampler: StreamingLinearResampler | null = null;
  private readonly pipeline: LiveByteDanceRollingPipeline;
  private state: LiveCaptureState = {
    state: 'idle',
    normalizedEndSampleIndex: 0,
    skippedAnchorCount: 0,
  };

  constructor(private readonly options: LiveByteDanceControllerOptions) {
    this.pipeline = new LiveByteDanceRollingPipeline(options);
  }

  snapshot(): LiveCaptureState {
    return { ...this.state, ...this.pipeline.snapshot() };
  }

  async start(): Promise<void> {
    this.state = { ...this.state, state: 'requesting-permission' };
    try {
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error('Browser microphone capture requires getUserMedia.');
      }
      this.mediaStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.state = { ...this.state, state: 'initializing-audio' };
      this.audioContext = new AudioContext();
      await this.audioContext.audioWorklet.addModule(
        new URL('./bytedance-capture.worklet.js', import.meta.url)
      );
      this.resampler = new StreamingLinearResampler(this.audioContext.sampleRate);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'noteverse-bytedance-capture');
      this.workletNode.port.onmessage = (event: MessageEvent<WorkletPcmChunkMessage>) => {
        if (event.data.type !== 'pcm-chunk' || !this.resampler) {
          return;
        }
        const chunk = this.resampler.append({
          samples: event.data.samples,
          sourceStartSampleIndex: event.data.sourceStartSampleIndex,
        });
        this.pipeline.appendNormalizedPcm(chunk.samples, chunk.startSampleIndex);
      };
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      await this.pipeline.start();
      this.sourceNode.connect(this.workletNode);
      this.state = {
        ...this.pipeline.snapshot(),
        state: 'running',
        sourceSampleRateHz: this.audioContext.sampleRate,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      };
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.state = { ...this.state, state: 'stopping' };
    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    await this.audioContext?.close().catch(() => undefined);
    this.workletNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.resampler = null;
    await this.pipeline.stop().catch(() => undefined);
    this.state = {
      state: 'idle',
      normalizedEndSampleIndex: 0,
      skippedAnchorCount: 0,
    };
  }
}

type WorkletPcmChunkMessage = {
  type: 'pcm-chunk';
  sourceSampleRateHz: number;
  sourceStartSampleIndex: number;
  sourceEndSampleIndex: number;
  samples: Float32Array;
};

export function monoFromChannels(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0].slice();
  }
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    if (channel.length !== length) {
      throw new Error('All channels must have equal length for deterministic mono conversion.');
    }
    for (let index = 0; index < length; index += 1) {
      mono[index] += channel[index] / channels.length;
    }
  }
  return mono;
}

export function defaultLiveRingCapacitySamples(): number {
  return MODEL_WINDOW_SAMPLES
    + BYTEDANCE_ROLLING_ANCHOR_STEP_SAMPLES * 4
    + FUTURE_SAMPLES;
}

export function createLiveCaptureTimebase(input: {
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

function millisecondsToSamples(milliseconds: number): number {
  return Math.round(milliseconds / 1000 * MODEL_SAMPLE_RATE_HZ);
}
