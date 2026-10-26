import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';

/** Atomic application handoff of independently valid result and optional media. */
export type ContinuousPracticeCompletion = Readonly<{
  result: ContinuousPerformanceResult;
  recording: PerformanceRecording;
}>;
