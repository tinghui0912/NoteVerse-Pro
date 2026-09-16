import type {
  ByteDanceInferenceResult,
  ByteDanceLoadDiagnostics,
  ByteDanceModelManifest,
  ByteDancePcmInferenceRequest,
} from './bytedance-contract';
import { decodeByteDanceRawOutputs } from './bytedance-decoder';
import {
  ByteDanceOnnxInferenceCore,
  type ByteDanceModelLoader,
  type ByteDanceOnnxRuntime,
} from './bytedance-onnx-provider';

export type ByteDanceWorkerRequest =
  | { type: 'LOAD'; requestId: string; manifest: ByteDanceModelManifest }
  | { type: 'INFER'; requestId: string; input: ByteDancePcmInferenceRequest }
  | { type: 'DISPOSE'; requestId: string };

export type ByteDanceWorkerResponse =
  | { type: 'READY'; requestId: string; diagnostics?: ByteDanceLoadDiagnostics }
  | { type: 'RESULT'; requestId: string; result: ByteDanceInferenceResult }
  | { type: 'DISPOSED'; requestId: string }
  | { type: 'ERROR'; requestId: string; error: string };

export type ByteDanceWorkerRuntimeFactory = () => Promise<ByteDanceOnnxRuntime>;

export class ByteDanceWorkerHost {
  private runtime: ByteDanceWorkerProtocolRuntime | null = null;

  constructor(
    private readonly runtimeFactory: ByteDanceWorkerRuntimeFactory,
    private readonly modelLoader?: ByteDanceModelLoader
  ) {}

  async handle(message: ByteDanceWorkerRequest): Promise<ByteDanceWorkerResponse> {
    try {
      if (!this.runtime) {
        if (message.type !== 'LOAD') {
          throw new Error('ByteDance worker is not initialized.');
        }
        this.runtime = new ByteDanceWorkerProtocolRuntime(
          await this.runtimeFactory(),
          this.modelLoader
        );
      }
      const response = await this.runtime.handle(message);
      if (message.type === 'DISPOSE' && response.type === 'DISPOSED') {
        this.runtime = null;
      }
      return response;
    } catch (error) {
      return {
        type: 'ERROR',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class ByteDanceWorkerProtocolRuntime {
  private readonly core: ByteDanceOnnxInferenceCore;
  private ready = false;
  private activeInference: string | null = null;

  constructor(runtime: ByteDanceOnnxRuntime, modelLoader?: ByteDanceModelLoader) {
    this.core = new ByteDanceOnnxInferenceCore(runtime, modelLoader);
  }

  async handle(message: ByteDanceWorkerRequest): Promise<ByteDanceWorkerResponse> {
    try {
      if (message.type === 'LOAD') {
        if (this.activeInference) {
          throw new Error('ByteDance worker cannot LOAD while inference is active.');
        }
        if (this.ready) {
          throw new Error('ByteDance worker is already loaded; DISPOSE before loading another model.');
        }
        const diagnostics = await this.core.load(message.manifest);
        this.ready = true;
        return { type: 'READY', requestId: message.requestId, diagnostics };
      }
      if (message.type === 'DISPOSE') {
        if (this.activeInference) {
          throw new Error('ByteDance worker cannot DISPOSE while inference is active.');
        }
        await this.core.dispose();
        this.ready = false;
        this.activeInference = null;
        return { type: 'DISPOSED', requestId: message.requestId };
      }
      if (!this.ready) {
        throw new Error('ByteDance worker is not ready.');
      }
      if (this.activeInference) {
        throw new Error('ByteDance worker already has an active inference request.');
      }
      this.activeInference = message.requestId;
      try {
        const inferenceStartedAt = nowMs();
        const raw = await this.core.infer(message.input);
        const inferenceCompletedAt = nowMs();
        const events = decodeByteDanceRawOutputs(raw, message.input, {
          inferenceCompletedAtMs: inferenceCompletedAt,
        });
        const decodeCompletedAt = nowMs();
        return {
          type: 'RESULT',
          requestId: message.requestId,
          result: {
            requestId: message.input.requestId,
            events,
            inferenceCompletedAtMs: inferenceCompletedAt,
            diagnostics: {
              inputTensor: {
                name: 'audio',
                dtype: 'float32',
                shape: [1, message.input.pcm.length],
              },
              outputTensors: {
                regOnset: {
                  name: 'reg_onset_output',
                  dtype: 'float32',
                  shape: raw.reg_onset_shape,
                },
                frame: {
                  name: 'frame_output',
                  dtype: 'float32',
                  shape: raw.frame_shape,
                },
              },
              timingMs: {
                onnxInference: inferenceCompletedAt - inferenceStartedAt,
                decode: decodeCompletedAt - inferenceCompletedAt,
                workerTotal: decodeCompletedAt - inferenceStartedAt,
              },
            },
          },
        };
      } finally {
        this.activeInference = null;
      }
    } catch (error) {
      return {
        type: 'ERROR',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class ByteDanceBrowserWorkerClient {
  private sequence = 0;
  private readonly pending = new Map<string, (response: ByteDanceWorkerResponse) => void>();

  constructor(private readonly worker: Worker) {
    this.worker.addEventListener('message', (event: MessageEvent<ByteDanceWorkerResponse>) => {
      const resolver = this.pending.get(event.data.requestId);
      if (resolver) {
        this.pending.delete(event.data.requestId);
        resolver(event.data);
      }
    });
  }

  async load(manifest: ByteDanceModelManifest): Promise<ByteDanceLoadDiagnostics | undefined> {
    const response = await this.send({ type: 'LOAD', requestId: this.nextId(), manifest });
    if (response.type !== 'READY') {
      throw new Error(response.type === 'ERROR' ? response.error : 'ByteDance worker load failed.');
    }
    return response.diagnostics;
  }

  async infer(input: ByteDancePcmInferenceRequest): Promise<ByteDanceInferenceResult> {
    const response = await this.send({ type: 'INFER', requestId: this.nextId(), input });
    if (response.type !== 'RESULT') {
      throw new Error(response.type === 'ERROR' ? response.error : 'ByteDance worker inference failed.');
    }
    return response.result;
  }

  async dispose(): Promise<void> {
    const response = await this.send({ type: 'DISPOSE', requestId: this.nextId() });
    if (response.type !== 'DISPOSED') {
      throw new Error(response.type === 'ERROR' ? response.error : 'ByteDance worker dispose failed.');
    }
  }

  private send(message: ByteDanceWorkerRequest): Promise<ByteDanceWorkerResponse> {
    this.worker.postMessage(message);
    return new Promise((resolve) => {
      this.pending.set(message.requestId, resolve);
    });
  }

  private nextId(): string {
    this.sequence += 1;
    return `bytedance-worker:${this.sequence}`;
  }
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
