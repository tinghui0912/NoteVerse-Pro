import { AcousticFailure } from '@/lib/practice/failure/causal-failure';
import { AcousticEngine, type AcousticEngineState } from '@/lib/practice/acoustic/model/acoustic-engine';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { getPracticeAcousticModelAccess } from '@/lib/api/practice-acoustic-model-asset';
import { validateAcousticCapture } from './browser-acoustic-validation';

export type EnvironmentPlatform = {
  modelUrl(signal: AbortSignal): Promise<string>;
  createEngine(): AcousticEngine;
  validateCapture: typeof validateAcousticCapture;
};
const browserPlatform: EnvironmentPlatform = {
  modelUrl: async signal => {
    try { return (await getPracticeAcousticModelAccess(signal)).downloadUrl; }
    catch (cause) { throw new AcousticFailure('MODEL_ASSET_UNAVAILABLE', { cause }); }
  },
  createEngine: () => new AcousticEngine(), validateCapture: validateAcousticCapture,
};

/** Workspace acoustic infrastructure only. Physical roots are borrowed for validation. */
export class PracticeEnvironment {
  private engine: AcousticEngine | null = null;
  private disposed = false;
  private pending: Promise<void> | null = null;
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly platform: EnvironmentPlatform = browserPlatform) {}
  // These observations describe the engine itself, never aggregate qualification evidence.
  acousticState = (): AcousticEngineState => this.disposed ? 'DISPOSED' : this.engine?.snapshot().state ?? 'EMPTY';
  subscribeAcoustic = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  validateAcoustic(options: { inputMicrophone: MediaStream; signal: AbortSignal; onProgress?: (percent: number | null) => void }): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('PRACTICE_ENVIRONMENT_DISPOSED'));
    const previous = this.pending;
    const signal = AbortSignal.any([options.signal, this.lifetime.signal]);
    const check = () => signal.throwIfAborted();
    const operation = (async () => {
      if (previous) await previous.catch(() => {});
      check();
      await this.platform.validateCapture(options.inputMicrophone, signal); check();
      if (this.engine) await this.awaitEngineRetirement(this.engine, signal);
      check();
      if (!this.engine || ['FAILED', 'DISPOSED'].includes(this.engine.snapshot().state)) {
        await this.engine?.dispose(); check();
        this.engine = this.platform.createEngine();
        this.engine.subscribe(() => { for (const listener of this.listeners) listener(); });
      }
      if (this.engine.snapshot().state === 'EMPTY') {
        const url = await this.platform.modelUrl(signal); check();
        await this.engine.prepare(url, progress => {
          if (!signal.aborted) options.onProgress?.(progress.totalBytes ? Math.floor(progress.bytesDownloaded / progress.totalBytes * 100) : null);
        });
      }
      check();
      if (this.engine.snapshot().state !== 'READY_IDLE') throw new AcousticFailure('ENVIRONMENT_NOT_READY');
    })();
    const pending = operation.finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
  /** Observe the previous owner's handoff; only that owner can release its lease. */
  private awaitEngineRetirement(engine: AcousticEngine, signal: AbortSignal): Promise<void> {
    const retiring = () => { const state = engine.snapshot().state; return state === 'LEASED' || state === 'RETIRING'; };
    if (signal.aborted) return Promise.reject(new Error('PRACTICE_PREPARATION_CANCELLED'));
    if (!retiring()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; unsubscribe(); signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const aborted = () => finish(new Error('PRACTICE_PREPARATION_CANCELLED'));
      const changed = () => { if (!retiring()) finish(); };
      unsubscribe = engine.subscribe(changed);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted(); else changed();
    });
  }
  acquireInference = async (signal: AbortSignal): Promise<AcousticInferencePort> => {
    if (this.disposed || this.engine?.snapshot().state !== 'READY_IDLE') throw new AcousticFailure('ENVIRONMENT_NOT_READY');
    return this.engine.acquire(signal);
  };
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.lifetime.abort();
    try { await this.engine?.dispose(); await this.pending?.catch(() => {}); }
    finally { this.listeners.clear(); }
  }
}
