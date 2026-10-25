import type { SessionTime } from '@/lib/practice/kernel/timebase';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { PerformanceClockSnapshot } from './performance-clock';

export type ContinuousMidiAttack = Readonly<{
  captureTime: SessionTime;
  pitch: string;
  confidence: number;
}>;

/** A clock-driven input publishes coverage before the session completes evaluation. */
export interface ContinuousClockDrivenEvidencePort {
  observe(pitch: string, performanceTimeMs: number, confidence: number): void;
  advance(snapshot: PerformanceClockSnapshot): ContinuousEvidencePublication | null;
  complete(snapshot: PerformanceClockSnapshot): ContinuousEvidencePublication | null;
}
