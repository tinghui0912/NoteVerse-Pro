import { AcousticAnalysisError } from './model-contract';
import type { AcousticInferenceInput, AcousticInferenceResult } from '../runtime/inference-types';
import type { ModelAssetProgressCallback } from '../../../model-assets/types';

export class AcousticModelWorker {
  private sequence = 0;
  private state: 'EMPTY' | 'READY' | 'CLOSED' = 'EMPTY';
  private busy = false;
  private failureListener: ((error: Error) => void) | null = null;
  private progress: ModelAssetProgressCallback | undefined;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', event => {
      const pending = this.pending.get(event.data.id);
      if (!pending) { this.terminate('UNEXPECTED_WORKER_RESPONSE'); return; }
      if (event.data.type === 'PROGRESS') { this.progress?.(event.data.progress); return; }
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new AcousticAnalysisError(event.data.error));
      else pending.resolve(event.data.result);
    });
    worker.addEventListener('error', () => this.terminate('ACOUSTIC_WORKER_CRASH'));
    worker.addEventListener('messageerror', () => this.terminate('ACOUSTIC_WORKER_MESSAGE_ERROR'));
  }
  async load(modelUrl: string, progress?: ModelAssetProgressCallback): Promise<unknown> {
    if (this.state !== 'EMPTY' || this.busy) throw new AcousticAnalysisError('ACOUSTIC_WORKER_NOT_EMPTY');
    this.busy = true;
    this.progress = progress;
    try { const result = await this.send({ type: 'LOAD', modelUrl }); this.state = 'READY'; return result; }
    catch (error) { this.terminate(); throw error; }
    finally { this.busy = false; this.progress = undefined; }
  }
  async beginSession(sessionId: string): Promise<void> {
    if (this.state !== 'READY' || this.busy) throw new AcousticAnalysisError('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
    this.busy = true;
    try { await this.send({ type: 'BEGIN_SESSION', sessionId }); } finally { this.busy = false; }
  }
  async endSession(sessionId: string): Promise<void> {
    if (this.state !== 'READY' || this.busy) throw new AcousticAnalysisError('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
    this.busy = true;
    try { await this.send({ type: 'END_SESSION', sessionId }); } finally { this.busy = false; }
  }
  async run(sessionId: string, input: AcousticInferenceInput): Promise<AcousticInferenceResult> {
    if (this.state !== 'READY' || this.busy) throw new AcousticAnalysisError('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
    this.busy = true;
    try { return await this.send({ type: 'INFER', sessionId, input }) as AcousticInferenceResult; }
    catch (error) { this.terminate(); throw error; }
    finally { this.busy = false; }
  }
  async dispose(): Promise<void> {
    if (this.state === 'CLOSED') return;
    if (this.busy) { this.terminate('ACOUSTIC_WORKER_DISPOSED'); return; }
    try { await this.send({ type: 'DISPOSE' }); } finally { this.terminate(); }
  }
  terminate(code = 'ACOUSTIC_WORKER_TERMINATED'): void {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    const error = new AcousticAnalysisError(code);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); this.worker.terminate();
    if (code !== 'ACOUSTIC_WORKER_TERMINATED' && code !== 'ACOUSTIC_WORKER_DISPOSED') this.failureListener?.(error);
  }
  onFailure(listener: (error: Error) => void): () => void {
    if (this.failureListener) throw new AcousticAnalysisError('ACOUSTIC_WORKER_ALREADY_OBSERVED');
    this.failureListener = listener;
    return () => { this.failureListener = null; };
  }
  private send(message: object): Promise<unknown> {
    if (this.state === 'CLOSED') return Promise.reject(new AcousticAnalysisError('ACOUSTIC_WORKER_TERMINATED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ ...message, id }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
}

/** Internal construction, deliberately absent from the user input capability registry. */
export function createAcousticModelWorker(): AcousticModelWorker {
  return new AcousticModelWorker(new Worker(new URL('./acoustic-worker.entry.ts', import.meta.url), { type: 'module' }));
}
