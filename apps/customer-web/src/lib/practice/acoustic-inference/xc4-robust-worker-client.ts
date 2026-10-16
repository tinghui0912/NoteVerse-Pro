import type { Xc4InferencePort, Xc4WorkerInput, Xc4WorkerResult } from './xc4-robust-worker-adapter';

export class Xc4BrowserWorkerClient implements Xc4InferencePort {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', event => {
      const p = this.pending.get(event.data.id); if (!p) return;
      this.pending.delete(event.data.id);
      if (event.data.error) p.reject(new Error(event.data.error)); else p.resolve(event.data.result);
    });
    worker.addEventListener('error', () => this.terminate('XC4_WORKER_CRASH'));
    worker.addEventListener('messageerror', () => this.terminate('XC4_WORKER_MESSAGE_ERROR'));
  }
  load(modelUrl: string): Promise<unknown> { return this.send({ type: 'LOAD', modelUrl }); }
  run(input: Xc4WorkerInput): Promise<Xc4WorkerResult> { return this.send({ type: 'RUN', input }) as Promise<Xc4WorkerResult>; }
  async dispose(): Promise<void> { await this.send({ type: 'DISPOSE' }); }
  terminate(reason = 'XC4_WORKER_TERMINATED'): void {
    this.closed = true; for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear(); this.worker.terminate();
  }
  private send(message: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('XC4_WORKER_TERMINATED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ ...message, id }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
}

/** Internal engineering construction only; not exported from the Practice capability/index. */
export function createXc4EngineeringWorker(): Xc4BrowserWorkerClient {
  return new Xc4BrowserWorkerClient(new Worker(new URL('./xc4-robust-worker.entry.ts', import.meta.url), { type: 'module' }));
}
