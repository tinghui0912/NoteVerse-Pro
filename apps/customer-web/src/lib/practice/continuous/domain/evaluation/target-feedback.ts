import type { ContinuousTargetState } from './assignment-types';
import type { CompletedContinuousEvaluation } from './evaluation-types';
import { immutableContinuousValue } from './immutable-value';

/** Settled target truth shared by live Practice and completed Review. */
export type ContinuousTargetFeedback = Readonly<{
  targets: readonly Readonly<{ strikeId: string; renderNoteIds: readonly string[]; state: 'MATCHED' | 'UNMATCHED' }>[];
}>;

export function projectContinuousTargetFeedback(targets: readonly ContinuousTargetState[]): ContinuousTargetFeedback {
  return immutableContinuousValue({
    targets: targets.flatMap(target => target.state === 'MATCHED' || target.state === 'UNMATCHED'
      ? [{ strikeId: target.strikeId, renderNoteIds: [...target.renderNoteIds], state: target.state }] : []),
  });
}

/** The completed artifact stays at the domain boundary; presentation receives no evidence. */
export function completedContinuousTargetFeedback(evaluation: CompletedContinuousEvaluation): ContinuousTargetFeedback {
  return projectContinuousTargetFeedback(evaluation.status === 'UNAVAILABLE' ? []
    : evaluation.assignment.groups.flatMap(group => group.strikes));
}
