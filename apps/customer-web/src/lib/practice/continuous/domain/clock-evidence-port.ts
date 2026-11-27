import type { PracticePianoKey } from '@/lib/practice/score/piano-key';
import type { SessionTime } from '@/lib/practice/session/timebase';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

export type ContinuousMidiAttack = Readonly<{
  captureTime: SessionTime;
  pianoKey: PracticePianoKey;
  confidence: number;
}>;

type ContinuousCoverageDeadline = Readonly<{
  analyzedThroughPerformanceMs: number;
  duePerformanceTimeMs: number;
}>;

/** Score-blind facts/grace owner; the session supplies only an evaluator frontier need. */
export interface ContinuousClockDrivenEvidencePort {
  observe(pianoKey: PracticePianoKey, performanceTimeMs: number, confidence: number, deliveryPerformanceTimeMs: number): void;
  nextDeadline(requiredAnalysisFrontierMs: number | null): ContinuousCoverageDeadline | null;
  cover(frontierPerformanceMs: number, availabilitySessionTimeMs: number): ContinuousEvidencePublication | null;
  complete(terminalPerformanceMs: number, availabilitySessionTimeMs: number): ContinuousEvidencePublication | null;
}
