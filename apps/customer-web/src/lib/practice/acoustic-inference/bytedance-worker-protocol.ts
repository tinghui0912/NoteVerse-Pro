import type {
  ByteDanceInferenceResult,
  ByteDanceModelManifest,
  ByteDancePcmInferenceRequest,
} from './bytedance-contract';
import { decodeByteDanceRawOutputs } from './bytedance-decoder';
import { ByteDanceOnnxInferenceCore, type ByteDanceOnnxRuntime } from './bytedance-onnx-provider';

export type ByteDanceWorkerRequest =
  | { type: 'LOAD'; requestId: string; manifest: ByteDanceModelManifest }
  | { type: 'INFER'; requestId: string; input: ByteDancePcmInferenceRequest }
  | { type: 'DISPOSE'; requestId: string };

export type ByteDanceWorkerResponse =
  | { type: 'READY'; requestId: string }
  | { type: 'RESULT'; requestId: string; result: ByteDanceInferenceResult }
  | { type: 'DISPOSED'; requestId: string }
  | { type: 'ERROR'; requestId: string; error: string };

export class ByteDanceWorkerProtocolRuntime {
  private readonly core: ByteDanceOnnxInferenceCore;
  private ready = false;
  private activeInference: string | null = null;

  constructor(runtime: ByteDanceOnnxRuntime) {
    this.core = new ByteDanceOnnxInferenceCore(runtime);
  }

  async handle(message: ByteDanceWorkerRequest): Promise<ByteDanceWorkerResponse> {
    try {
      if (message.type === 'LOAD') {
        await this.core.load(message.manifest);
        this.ready = true;
        return { type: 'READY', requestId: message.requestId };
      }
      if (message.type === 'DISPOSE') {
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
        const raw = await this.core.infer(message.input);
        const inferenceCompletedAtMs = message.input.inferenceRequestedAtMs;
        return {
          type: 'RESULT',
          requestId: message.requestId,
          result: {
            requestId: message.input.requestId,
            events: decodeByteDanceRawOutputs(raw, message.input, { inferenceCompletedAtMs }),
            inferenceCompletedAtMs,
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

  async load(manifest: ByteDanceModelManifest): Promise<void> {
    const response = await this.send({ type: 'LOAD', requestId: this.nextId(), manifest });
    if (response.type !== 'READY') {
      throw new Error(response.type === 'ERROR' ? response.error : 'ByteDance worker load failed.');
    }
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
