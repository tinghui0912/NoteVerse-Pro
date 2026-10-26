import { assertContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { createPerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { ContinuousPracticeCompletion } from './completion';

class ContinuousCompletionStore {
  private completion: ContinuousPracticeCompletion | null = null;
  private readonly listeners = new Set<(completion: ContinuousPracticeCompletion | null) => void>();
  getCompletion(): ContinuousPracticeCompletion | null { return this.completion; }
  setCompletion(completion: ContinuousPracticeCompletion): void {
    if (!completion || Object.keys(completion).sort().join() !== 'recording,result') throw new Error('Continuous completion is invalid.');
    assertContinuousPerformanceResult(completion.result);
    const recording = createPerformanceRecording(completion.recording);
    const result = immutableContinuousValue(structuredClone(completion.result));
    this.completion = Object.freeze({ result, recording });
    this.notify();
  }
  clearCompletion(): void { this.completion = null; this.notify(); }
  subscribe(listener: (completion: ContinuousPracticeCompletion | null) => void): () => void {
    this.listeners.add(listener); listener(this.completion); return () => { this.listeners.delete(listener); };
  }
  private notify(): void { for (const listener of this.listeners) listener(this.completion); }
}
export const continuousCompletionStore = new ContinuousCompletionStore();
