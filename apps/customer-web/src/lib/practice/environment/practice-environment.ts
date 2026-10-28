import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { getPracticeAcousticModelAccess } from '@/lib/api/practice-acoustic-model-asset';
import { requirementFingerprint, type PracticeRequirement } from '@/lib/practice/readiness/requirements';
import { unconfiguredReadiness, type PracticeReadiness } from '@/lib/practice/readiness/readiness-state';
import { probePracticeRequirements } from './browser-readiness-probes';

export type EnvironmentPlatform = {
  modelUrl(signal: AbortSignal): Promise<string>;
  createEngine(): AcousticEngine;
  probe: typeof probePracticeRequirements;
};
const browserPlatform: EnvironmentPlatform = {
  modelUrl: async signal => (await getPracticeAcousticModelAccess(signal)).downloadUrl,
  createEngine: () => new AcousticEngine(), probe: probePracticeRequirements,
};

/** Workspace infrastructure only. Readiness is live evidence, never persisted permission. */
export class PracticeEnvironment {
  private readiness: PracticeReadiness = unconfiguredReadiness;
  private engine: AcousticEngine | null = null;
  private abort: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  constructor(private readonly platform: EnvironmentPlatform = browserPlatform) {}
  snapshot = (): PracticeReadiness => this.readiness;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  matches(requirements: readonly PracticeRequirement[]): boolean {
    return this.readiness.status === 'READY' && this.readiness.fingerprint === requirementFingerprint(requirements)
      && (!requirements.includes('acousticEngine') || this.engine?.snapshot().state === 'READY_IDLE');
  }
  /** Explicit qualification always rechecks external requirements; a healthy warm engine is reused. */
  requalify(requirements: readonly PracticeRequirement[]): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('PRACTICE_ENVIRONMENT_DISPOSED'));
    if (this.pending) return Promise.reject(new Error('PRACTICE_ENVIRONMENT_BUSY'));
    const epoch = ++this.epoch, abort = new AbortController(); this.abort = abort;
    const fingerprint = requirementFingerprint(requirements);
    this.update({ status: 'CHECKING', fingerprint, components: Object.fromEntries(requirements.map(key => [key, 'CHECKING'])), reason: null, progress: null });
    const check = () => { if (abort.signal.aborted || this.disposed || epoch !== this.epoch) throw new Error('PRACTICE_PREPARATION_CANCELLED'); };
    const ready = (key: PracticeRequirement) => {
      check(); this.update({ ...this.readiness, components: { ...this.readiness.components, [key]: 'READY' } });
    };
    this.pending = (async () => {
      try {
        await this.platform.probe(requirements, ready, abort.signal); check();
        if (requirements.includes('acousticEngine')) {
          if (this.engine) { await this.awaitEngineRetirement(this.engine, abort.signal); check(); }
          if (!this.engine || ['FAILED', 'DISPOSED'].includes(this.engine.snapshot().state)) {
            await this.engine?.dispose(); check();
            this.engine = this.platform.createEngine();
            this.engine.subscribe(() => { if (!this.disposed) this.update({ ...this.readiness }); });
            this.engine.onFailure(error => {
              if (this.readiness.status === 'READY' && this.readiness.components.acousticEngine === 'READY') this.invalidate(error.message);
            });
          }
          if (this.engine.snapshot().state === 'EMPTY') {
            const url = await this.platform.modelUrl(abort.signal); check();
            await this.engine.prepare(url, progress => {
              if (!abort.signal.aborted) this.update({ ...this.readiness,
                progress: progress.totalBytes ? Math.floor(progress.bytesDownloaded / progress.totalBytes * 100) : null });
            });
          }
          check(); if (this.engine.snapshot().state !== 'READY_IDLE') throw new Error('ACOUSTIC_ENGINE_NOT_IDLE');
          ready('acousticEngine');
        }
        check(); this.update({ ...this.readiness, status: 'READY', progress: null });
      } catch (error) {
        if (!this.disposed && epoch === this.epoch) this.invalidate(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message : 'PRACTICE_PREPARATION_FAILED');
      } finally { this.pending = null; }
    })();
    return this.pending;
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
    if (this.disposed || this.readiness.status !== 'READY' || !this.readiness.components.acousticEngine
      || this.engine?.snapshot().state !== 'READY_IDLE') throw new Error('PRACTICE_ENVIRONMENT_NOT_READY');
    return this.engine.acquire(signal);
  };
  invalidate(reason: string): void {
    if (this.disposed) return;
    this.update({ ...this.readiness, status: 'BLOCKED', reason,
      components: Object.fromEntries(Object.entries(this.readiness.components).map(([key, state]) =>
        [key, state === 'CHECKING' || (key === 'acousticEngine' && this.engine?.snapshot().state === 'FAILED') ? 'BLOCKED' : state])) });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.epoch++; this.abort?.abort();
    try { await this.engine?.dispose(); }
    finally {
      await this.pending;
      this.listeners.clear(); this.readiness = unconfiguredReadiness;
    }
  }
  private update(value: PracticeReadiness): void {
    this.readiness = Object.freeze({ ...value, components: Object.freeze({ ...value.components }) });
    for (const listener of this.listeners) listener();
  }
}
