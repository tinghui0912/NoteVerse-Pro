import { AcousticAnalysisError, isAcousticAnalysisErrorCode, type AcousticAnalysisErrorCode } from './model-contract';
import { acousticBoundaryFailure } from '../failure-boundary';
import { InferenceFailure } from '@/lib/practice/failure/causal-failure';
import { ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS } from './worker-liveness-policy';
import type { AcousticInferenceInput, AcousticInferenceResult } from '../runtime/inference-types';
import type { ModelAssetProgressCallback } from '../../../model-assets/types';

type PendingRequest = {
  type: string;
  timer: ReturnType<typeof setTimeout> | null;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export class AcousticModelWorker {
  private sequence = 0;
  private state: 'EMPTY' | 'READY' | 'CLOSED' = 'EMPTY';
  private busy = false;
  private terminalError: Error | null = null;
  private failureListener: ((error: Error) => void) | null = null;
  private progress: ModelAssetProgressCallback | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', event => {
      if (this.state === 'CLOSED') return;
      const message = event.data;
      const pending = message && this.pending.get(message.id);
      if (!pending) { this.terminate('UNEXPECTED_WORKER_RESPONSE'); return; }
      if (message.type === 'PROGRESS') {
        const progress = message.progress;
        if (pending.type !== 'LOAD' || Object.keys(message).sort().join() !== 'id,progress,type'
          || !progress || Object.keys(progress).sort().join() !== 'bytesDownloaded,totalBytes'
          || !Number.isSafeInteger(progress.bytesDownloaded) || progress.bytesDownloaded < 0
          || progress.totalBytes !== null && (!Number.isSafeInteger(progress.totalBytes) || progress.totalBytes < 0)) return;
        this.watchSilence(message.id, pending); this.progress?.(progress); return;
      }
      const fields = Object.keys(message).sort().join();
      if (fields !== 'id,result' && !(fields === 'error,id' && typeof message.error === 'string')) return;
      this.clearWatchdog(pending); this.pending.delete(message.id);
      if (fields === 'error,id') pending.reject(isAcousticAnalysisErrorCode(message.error)
        ? acousticBoundaryFailure(new AcousticAnalysisError(message.error))
        : new InferenceFailure('PROTOCOL_INVALID', { cause: message.error }));
      else pending.resolve(event.data.result);
    });
    worker.addEventListener('error', () => this.terminate('ACOUSTIC_WORKER_CRASH'));
    worker.addEventListener('messageerror', () => this.terminate('ACOUSTIC_WORKER_MESSAGE_ERROR'));
  }
  async load(modelUrl: string, progress?: ModelAssetProgressCallback): Promise<unknown> {
    if (this.state !== 'EMPTY' || this.busy) throw new AcousticAnalysisError('ACOUSTIC_WORKER_NOT_EMPTY');
    this.busy = true;
    this.progress = progress;
    try {
      const result = await this.send({ type: 'LOAD', modelUrl });
      if (this.terminalError) throw this.terminalError;
      this.state = 'READY'; return result;
    }
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
  terminate(code: AcousticAnalysisErrorCode = 'ACOUSTIC_WORKER_TERMINATED'): void {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    const error = acousticBoundaryFailure(new AcousticAnalysisError(code)); this.terminalError = error;
    for (const pending of this.pending.values()) { this.clearWatchdog(pending); pending.reject(error); }
    this.pending.clear(); this.worker.terminate();
    if (code !== 'ACOUSTIC_WORKER_TERMINATED' && code !== 'ACOUSTIC_WORKER_DISPOSED') this.failureListener?.(error);
  }
  onFailure(listener: (error: Error) => void): () => void {
    if (this.failureListener) throw new AcousticAnalysisError('ACOUSTIC_WORKER_ALREADY_OBSERVED');
    this.failureListener = listener;
    return () => { this.failureListener = null; };
  }
  private clearWatchdog(pending: PendingRequest): void {
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;
  }
  private watchSilence(id: number, pending: PendingRequest): void {
    this.clearWatchdog(pending);
    pending.timer = setTimeout(() => {
      if (this.pending.get(id) === pending) this.terminate('ACOUSTIC_WORKER_RPC_TIMEOUT');
    }, ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS);
  }
  private send(message: { type: string; [key: string]: unknown }): Promise<unknown> {
    if (this.state === 'CLOSED') return Promise.reject(new AcousticAnalysisError('ACOUSTIC_WORKER_TERMINATED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { type: message.type, timer: null, resolve, reject };
      this.pending.set(id, pending); this.watchSilence(id, pending);
      try { this.worker.postMessage({ ...message, id }); }
      catch (error) {
        if (this.pending.get(id) === pending) {
          this.clearWatchdog(pending); this.pending.delete(id); reject(new InferenceFailure('PROTOCOL_INVALID', { cause: error }));
        }
      }
    });
  }
}

/** Internal construction, deliberately absent from the user input capability registry. */
export function createAcousticModelWorker(): AcousticModelWorker {
  try { return new AcousticModelWorker(new Worker(new URL('./acoustic-worker.entry.ts', import.meta.url), { type: 'module' })); }
  catch (cause) { throw new InferenceFailure('RUNTIME_FAILED', { cause }); }
}
