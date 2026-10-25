import type { MidiStrikeFeedback, AcousticStrikeFeedback } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
type SummaryBase = Readonly<{ targetStrikeCount: number; notReachedStrikeCount: number }>;
export type ContinuousReviewSummary =
  | Readonly<{ status: 'UNAVAILABLE'; inputSource: 'MIDI' | 'MICROPHONE'; targetStrikeCount: number; reason: string }>
  | (SummaryBase & Readonly<{ status: 'COMPLETE'; inputSource: 'MIDI'; correctStrikeCount: number; missingStrikeCount: number; wrongStrikeCount: number; extraObservationCount: number }>)
  | (SummaryBase & Readonly<{ status: 'COMPLETE'; inputSource: 'MICROPHONE'; supportedStrikeCount: number; unconfirmedStrikeCount: number }>);
export function continuousReviewSummary({ artifact, scope, evaluation }: {
  artifact: PracticeScoreArtifact | null | undefined; scope: ResolvedPracticeScope; evaluation: CompletedContinuousEvaluation;
}): ContinuousReviewSummary {
  const expected = artifact?.expectedPracticeGroups.slice(scope.startIndex, scope.endIndex + 1).flatMap(group => group.strikeTargets) ?? [];
  if (evaluation.status === 'UNAVAILABLE') return Object.freeze({ status: 'UNAVAILABLE', inputSource: evaluation.inputSource, targetStrikeCount: expected.length, reason: evaluation.reason });
  const feedback = evaluation.interpretation;
  const strikes = feedback.groups.flatMap<MidiStrikeFeedback | AcousticStrikeFeedback>(group => group.strikes);
  const byId = new Map(strikes.map(strike => [strike.strikeId, strike]));
  const selected = expected.length ? expected.map(strike => byId.get(strike.strikeId)) : strikes;
  const base = { status: 'COMPLETE' as const, targetStrikeCount: selected.length,
    notReachedStrikeCount: selected.filter(strike => !strike || strike.state === 'NOT_REACHED').length };
  if (feedback.inputSource === 'MIDI') return Object.freeze({ ...base, inputSource: 'MIDI',
    correctStrikeCount: selected.filter(strike => strike?.state === 'CORRECT').length,
    missingStrikeCount: selected.filter(strike => strike?.state === 'MISSING').length,
    wrongStrikeCount: selected.filter(strike => strike?.state === 'WRONG').length, extraObservationCount: feedback.extraObservations.length });
  return Object.freeze({ ...base, inputSource: 'MICROPHONE',
    supportedStrikeCount: selected.filter(strike => strike?.state === 'SUPPORTED').length,
    unconfirmedStrikeCount: selected.filter(strike => strike?.state === 'UNCONFIRMED').length });
}
