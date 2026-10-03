import { StreamingLinearResampler, type NormalizedPcmChunk } from './streaming-resampler';

type BrowserPcmCaptureStateName =
  | 'idle'
  | 'requesting-permission'
  | 'initializing-audio'
  | 'running'
  | 'stopping'
  | 'error'
  | 'disposed';

export type BrowserPcmCaptureState = {
  state: BrowserPcmCaptureStateName;
  sourceSampleRateHz?: number;
  normalizedEndSampleIndex: number;
  workletChunkCount: number;
  sourceContinuityOk: boolean;
  lastSourceSampleIndex: number;
  lastError?: string;
};

export type BrowserPcmCaptureOptions = {
  targetSampleRateHz: number;
  workletModuleUrl: URL;
  workletProcessorName: string;
  onBeforeRunning?: (sourceSampleRateHz: number) => Promise<{ initialOutputSampleIndex?: number } | void>;
  onPcmChunk: (chunk: NormalizedPcmChunk) => void;
  onFatalError?: (error: Error) => void;
};

type BrowserPcmCaptureLifecycle = {
  cancelled: boolean;
  stoppedByStop: boolean;
  mediaStream: MediaStream | null;
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  sinkNode: GainNode | null;
  resampler: StreamingLinearResampler | null;
  workletChunkCount: number;
  sourceContinuityOk: boolean;
  expectedSourceSampleIndex: number;
};

export class BrowserPcmCaptureController {
  private generation = 0;
  private currentLifecycle: BrowserPcmCaptureLifecycle | null = null;
  private state: BrowserPcmCaptureState = {
    state: 'idle',
    normalizedEndSampleIndex: 0,
    workletChunkCount: 0,
    sourceContinuityOk: true,
    lastSourceSampleIndex: 0,
  };

  constructor(private readonly options: BrowserPcmCaptureOptions) {
  }

  snapshot(): BrowserPcmCaptureState {
    const lc = this.currentLifecycle;
    return {
      ...this.state,
      workletChunkCount: lc?.workletChunkCount ?? this.state.workletChunkCount,
      sourceContinuityOk: lc?.sourceContinuityOk ?? this.state.sourceContinuityOk,
      lastSourceSampleIndex: lc?.expectedSourceSampleIndex ?? this.state.lastSourceSampleIndex,
    };
  }

  get mediaStream(): MediaStream | null {
    return this.currentLifecycle?.mediaStream ?? null;
  }

  async start(): Promise<void> {
    const currentState = this.state.state;
    if (
      currentState === 'running'
      || currentState === 'requesting-permission'
      || currentState === 'initializing-audio'
      || currentState === 'stopping'
    ) {
      throw new Error(`Cannot start PCM capture: controller is already in '${currentState}' state.`);
    }
    this.generation += 1;
    const lc: BrowserPcmCaptureLifecycle = {
      cancelled: false,
      stoppedByStop: false,
      mediaStream: null,
      audioContext: null,
      sourceNode: null,
      workletNode: null,
      sinkNode: null,
      resampler: null,
      workletChunkCount: 0,
      sourceContinuityOk: true,
      expectedSourceSampleIndex: 0,
    };
    this.currentLifecycle = lc;
    this.state = {
      state: 'requesting-permission',
      normalizedEndSampleIndex: 0,
      workletChunkCount: 0,
      sourceContinuityOk: true,
      lastSourceSampleIndex: 0,
    };
    try {
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error('Browser PCM capture requires getUserMedia.');
      }
      lc.mediaStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (lc.cancelled) {
        void releasePcmCaptureResources(lc);
        return;
      }

      this.state = { ...this.state, state: 'initializing-audio' };
      lc.audioContext = new AudioContext();
      await lc.audioContext.audioWorklet.addModule(this.options.workletModuleUrl);
      if (lc.cancelled) {
        void releasePcmCaptureResources(lc);
        return;
      }

      const beforeRunning = await this.options.onBeforeRunning?.(lc.audioContext.sampleRate);
      if (lc.cancelled) {
        void releasePcmCaptureResources(lc);
        return;
      }

      lc.resampler = new StreamingLinearResampler(
        lc.audioContext.sampleRate,
        this.options.targetSampleRateHz,
        beforeRunning?.initialOutputSampleIndex ?? 0
      );
      lc.workletNode = new AudioWorkletNode(lc.audioContext, this.options.workletProcessorName);
      lc.workletNode.addEventListener('processorerror', (event) => {
        if (this.currentLifecycle !== lc || lc.cancelled) {
          return;
        }
        this.handleFatalError(new Error(`AudioWorklet processor failed: ${event.type}`), lc);
      });
      lc.workletNode.port.onmessage = (event: MessageEvent<WorkletPcmChunkMessage>) => {
        if (this.currentLifecycle !== lc || lc.cancelled) {
          return;
        }
        try {
          if (event.data.type !== 'pcm-chunk' || !lc.resampler) {
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
          this.state = {
            ...this.state,
            normalizedEndSampleIndex: chunk.endSampleIndex,
            workletChunkCount: lc.workletChunkCount,
            sourceContinuityOk: lc.sourceContinuityOk,
            lastSourceSampleIndex: lc.expectedSourceSampleIndex,
          };
          this.options.onPcmChunk(chunk);
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
        ...this.state,
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
      await releasePcmCaptureResources(lc);
      if (!lc.stoppedByStop) {
        throw error;
      }
    }
  }

  async stop(): Promise<void> {
    if (this.state.state === 'idle') {
      return;
    }
    this.generation += 1;
    const lc = this.currentLifecycle;
    this.currentLifecycle = null;
    this.state = { ...this.state, state: 'stopping' };
    if (lc) {
      lc.cancelled = true;
      lc.stoppedByStop = true;
      await releasePcmCaptureResources(lc);
    }
    this.state = {
      state: 'idle',
      normalizedEndSampleIndex: 0,
      workletChunkCount: 0,
      sourceContinuityOk: true,
      lastSourceSampleIndex: 0,
    };
  }

  private handleFatalError(error: unknown, lc: BrowserPcmCaptureLifecycle): void {
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
    void releasePcmCaptureResources(lc);
    this.options.onFatalError?.(fatalError);
  }
}

type WorkletPcmChunkMessage = {
  type: 'pcm-chunk';
  sourceSampleRateHz: number;
  sourceStartSampleIndex: number;
  sourceEndSampleIndex: number;
  samples: Float32Array;
};

function releasePcmCaptureResources(lc: BrowserPcmCaptureLifecycle): Promise<void> {
  lc.workletNode?.port.close();
  lc.workletNode?.disconnect();
  lc.sinkNode?.disconnect();
  lc.sourceNode?.disconnect();
  for (const track of lc.mediaStream?.getTracks() ?? []) {
    track.stop();
  }
  const audioClosePromise = lc.audioContext?.close().catch(() => undefined) ?? Promise.resolve();
  lc.mediaStream = null;
  lc.audioContext = null;
  lc.sourceNode = null;
  lc.workletNode = null;
  lc.sinkNode = null;
  lc.resampler = null;
  return audioClosePromise.then(() => undefined);
}
