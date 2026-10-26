import type { MidiStrikeFeedback, AcousticStrikeFeedback } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';

export const CONTINUOUS_METRICS_POLICY_ID = 'CONTINUOUS_PRODUCT_METRICS_V1';
type MetricsIdentity = Readonly<{ metricsPolicyId: typeof CONTINUOUS_METRICS_POLICY_ID; targetStrikeCount: number }>;
export type ContinuousPerformanceMetrics = MetricsIdentity & (
  | Readonly<{ status: 'UNAVAILABLE'; inputSource: 'MIDI' | 'MICROPHONE'; reason: string }>
  | Readonly<{ status: 'COMPLETE'; inputSource: 'MIDI'; correctStrikeCount: number; wrongStrikeCount: number;
      missingStrikeCount: number; notReachedStrikeCount: number; extraObservationCount: number }>
  | Readonly<{ status: 'COMPLETE'; inputSource: 'MICROPHONE'; supportedStrikeCount: number;
      unconfirmedStrikeCount: number; notReachedStrikeCount: number }>
);

/** Learner aggregates derive only from the session-bound interpretation. */
export function createContinuousPerformanceMetrics(evaluation: CompletedContinuousEvaluation, targetStrikeCount: number): ContinuousPerformanceMetrics {
  if (!Number.isSafeInteger(targetStrikeCount) || targetStrikeCount < 0) throw new Error('Continuous target count is invalid.');
  const identity: MetricsIdentity = { metricsPolicyId: CONTINUOUS_METRICS_POLICY_ID, targetStrikeCount };
  if (evaluation.status === 'UNAVAILABLE') return Object.freeze({ ...identity, status: 'UNAVAILABLE', inputSource: evaluation.inputSource, reason: evaluation.reason });
  const feedback = evaluation.interpretation;
  const strikes = feedback.groups.flatMap<MidiStrikeFeedback | AcousticStrikeFeedback>(group => group.strikes);
  if (strikes.length !== targetStrikeCount) throw new Error('Continuous metrics target coverage is inconsistent.');
  const notReachedStrikeCount = strikes.filter(strike => strike.state === 'NOT_REACHED').length;
  if (feedback.inputSource === 'MIDI') {
    const correctStrikeCount = strikes.filter(strike => strike.state === 'CORRECT').length;
    const wrongStrikeCount = strikes.filter(strike => strike.state === 'WRONG').length;
    const missingStrikeCount = strikes.filter(strike => strike.state === 'MISSING').length;
    if (targetStrikeCount !== correctStrikeCount + wrongStrikeCount + missingStrikeCount + notReachedStrikeCount) {
      throw new Error('Continuous MIDI target outcomes are incomplete.');
    }
    return Object.freeze({ ...identity, status: 'COMPLETE', inputSource: 'MIDI', correctStrikeCount, wrongStrikeCount,
      missingStrikeCount, notReachedStrikeCount, extraObservationCount: feedback.extraObservations.length });
  }
  const supportedStrikeCount = strikes.filter(strike => strike.state === 'SUPPORTED').length;
  const unconfirmedStrikeCount = strikes.filter(strike => strike.state === 'UNCONFIRMED').length;
  if (targetStrikeCount !== supportedStrikeCount + unconfirmedStrikeCount + notReachedStrikeCount) {
    throw new Error('Continuous acoustic target support is incomplete.');
  }
  return Object.freeze({ ...identity, status: 'COMPLETE', inputSource: 'MICROPHONE', supportedStrikeCount, unconfirmedStrikeCount, notReachedStrikeCount });
}
export function assertContinuousPerformanceMetrics(metrics: ContinuousPerformanceMetrics, evaluation: CompletedContinuousEvaluation): void {
  const expected = createContinuousPerformanceMetrics(evaluation, metrics.targetStrikeCount);
  if (Object.keys(metrics).sort().join() !== Object.keys(expected).sort().join()
    || Object.entries(expected).some(([key, value]) => Reflect.get(metrics, key) !== value)) {
    throw new Error('Continuous stored metrics are not an interpretation projection.');
  }
}
