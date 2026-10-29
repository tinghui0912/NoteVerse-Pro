import { createAcousticModelWorker, type AcousticModelWorker } from './worker-client';
import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS } from './model-contract';
import type { AcousticInferenceInput, AcousticInferencePort } from '../runtime/inference-types';
import type { ModelAssetProgressCallback } from '../../../model-assets/types';

type EngineWorker = Pick<AcousticModelWorker, 'load' | 'beginSession' | 'run' | 'endSession' | 'dispose' | 'terminate' | 'onFailure'>;
export type AcousticEngineState = 'EMPTY' | 'PREPARING' | 'READY_IDLE' | 'LEASED' | 'RETIRING' | 'FAILED' | 'DISPOSED';

/** Workspace model/GPU ownership. Every inference lease is a new source-blind analysis session. */
export class AcousticEngine {
  private engineState: AcousticEngineState = 'EMPTY';
  private readonly stateListeners = new Set<() => void>();
  private get state() { return this.engineState; }
  private set state(value: AcousticEngineState) {
    this.engineState = value;
    for (const listener of this.stateListeners) listener();
  }
  private worker: EngineWorker | null = null;
  private operation: Promise<void> | null = null;
  private retire: (() => Promise<void>) | null = null;
  private generation = 0;
  private failure: Error | null = null;
  private readonly listeners = new Set<(error: Error) => void>();
  private detach: (() => void) | undefined;
  constructor(private readonly createWorker: () => EngineWorker = createAcousticModelWorker) {}
  snapshot() { return Object.freeze({ state: this.state, failure: this.failure?.message ?? null }); }
  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); };
  }
  onFailure(listener: (error: Error) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  prepare(modelUrl: string, progress?: ModelAssetProgressCallback): Promise<void> {
    if (this.state === 'READY_IDLE') return Promise.resolve();
    if (this.state === 'PREPARING') return this.operation!;
    if (this.state !== 'EMPTY') return Promise.reject(new Error('ACOUSTIC_ENGINE_NOT_EMPTY'));
    this.state = 'PREPARING';
    this.operation = (async () => {
      try {
        this.worker = this.createWorker();
        this.detach = this.worker.onFailure(error => this.fail(error));
        await this.worker!.load(modelUrl, progress);
        if (this.state !== 'PREPARING') throw new Error('ACOUSTIC_ENGINE_DISPOSED');
        this.state = 'READY_IDLE';
        const smoke = await this.acquire();
        try {
          const smokeOwnedEndTarget = M.inputSamples - M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS;
          const smokeOwnedStartTarget = smokeOwnedEndTarget - M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS;
          await smoke.run({ pcm: new Float32Array(M.inputSamples), window: { jobIndex: 0, regionIndex: 0, windowIndex: 0,
            ownedStartTarget: smokeOwnedStartTarget, ownedEndTarget: smokeOwnedEndTarget, startSample: 0, endSample: M.inputSamples } });
        } finally { await smoke.dispose(); }
      } catch (error) { this.fail(error); throw error; }
    })();
    return this.operation;
  }
  async acquire(signal?: AbortSignal): Promise<AcousticInferencePort> {
    if (signal?.aborted || this.state !== 'READY_IDLE') throw new Error('PRACTICE_ENVIRONMENT_NOT_READY');
    this.state = 'LEASED';
    const token = `acoustic-lease-${++this.generation}`;
    try { await this.worker!.beginSession(token); } catch (error) { this.fail(error); throw error; }
    if (this.state !== 'LEASED') throw this.failure ?? new Error('ACOUSTIC_ENGINE_DISPOSED');
    let retired = false;
    let inFlight: Promise<unknown> | null = null;
    let retirement: Promise<void> | null = null;
    const detachments = new Set<() => void>();
    const dispose = (): Promise<void> => {
      if (retirement) return retirement;
      retired = true;
      signal?.removeEventListener('abort', aborted);
      if (this.state === 'LEASED') this.state = 'RETIRING';
      retirement = (async () => {
        try {
          await inFlight?.catch(() => {});
          if (this.state === 'RETIRING') {
            await this.worker!.endSession(token);
            if (this.state === 'RETIRING') this.state = 'READY_IDLE';
          }
        } catch (error) { this.fail(error); throw error; }
        finally { for (const detach of detachments) detach(); this.retire = null; }
      })();
      return retirement;
    };
    const aborted = () => { void dispose().catch(() => {}); };
    const run = async (input: AcousticInferenceInput) => {
      if (retired || this.state !== 'LEASED') throw new Error('ACOUSTIC_LEASE_RETIRED');
      if (inFlight) throw new Error('ACOUSTIC_LEASE_CONCURRENT_INFERENCE');
      const pending = this.worker!.run(token, input); inFlight = pending;
      try {
        const result = await pending;
        if (retired || this.state !== 'LEASED') throw new Error('ACOUSTIC_LEASE_RETIRED');
        return result;
      } catch (error) { if (!retired) this.fail(error); throw error; }
      finally { inFlight = null; }
    };
    this.retire = dispose;
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { await dispose(); throw new Error('ACOUSTIC_LEASE_RETIRED'); }
    return Object.freeze({ run, dispose, onFailure: (listener: (error: Error) => void) => {
      const detach = this.onFailure(listener); detachments.add(detach);
      return () => { detach(); detachments.delete(detach); };
    } });
  }
  async dispose(): Promise<void> {
    if (this.state === 'DISPOSED') return;
    const retire = this.retire;
    if (retire) await retire().catch(() => {});
    const wasPreparing = this.state === 'PREPARING';
    this.state = 'DISPOSED'; this.detach?.(); this.detach = undefined;
    try {
      if (wasPreparing) this.worker?.terminate('ACOUSTIC_WORKER_DISPOSED');
      else await this.worker?.dispose();
    } finally { this.worker = null; this.listeners.clear(); this.stateListeners.clear(); }
  }
  private fail(error: unknown): void {
    if (this.state === 'FAILED' || this.state === 'DISPOSED') return;
    this.failure = error instanceof Error ? error : new Error(String(error)); this.state = 'FAILED';
    this.worker?.terminate();
    for (const listener of this.listeners) listener(this.failure);
  }
}
