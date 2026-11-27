import type { ExecutedPerformance } from '@/lib/practice/run/executed-performance';
import {
  assertPerformanceRecording,
  type ReadyPerformanceRecording,
} from './recording-artifact';
/** Pairing borrows its recording owner's reference; it does not acquire media. */
export type RecordedPerformance = Readonly<{
  executed: ExecutedPerformance;
  recording: ReadyPerformanceRecording;
}>;
export function recordedPerformance(
  executed: ExecutedPerformance,
  recording: ReadyPerformanceRecording,
): RecordedPerformance {
  assertPerformanceRecording(recording);
  return Object.freeze({ executed, recording });
}
