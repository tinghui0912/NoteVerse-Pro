import type {
  ByteDanceInferenceResult,
  ByteDanceLoadDiagnostics,
  ByteDanceModelManifest,
  ByteDancePcmInferenceRequest,
} from './bytedance-contract';
import type {
  ByteDanceWorkerRequest,
  ByteDanceWorkerResponse,
} from './bytedance-worker-protocol';

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

  terminate(reason = 'ByteDance worker was terminated.'): void {
    for (const [requestId, resolve] of this.pending.entries()) {
      resolve({ type: 'ERROR', requestId, error: reason });
    }
    this.pending.clear();
    this.worker.terminate();
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
