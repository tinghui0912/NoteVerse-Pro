import type { ContinuousTargetState } from './assignment-types';
import type { CompletedContinuousEvaluation } from './evaluation-types';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import { immutableContinuousValue } from './immutable-value';

/** Settled target truth shared by live Practice and completed Review. */
export type ContinuousTargetFeedback = Readonly<{
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  targets: readonly Readonly<{ strikeId: string; renderNoteIds: readonly string[]; state: 'MATCHED' | 'UNMATCHED' }>[];
}>;

export function projectContinuousTargetFeedback(targets: readonly ContinuousTargetState[]): ContinuousTargetFeedback {
  return immutableContinuousValue({ assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID,
    targets: targets.flatMap(target => target.state === 'MATCHED' || target.state === 'UNMATCHED'
      ? [{ strikeId: target.strikeId, renderNoteIds: [...target.renderNoteIds], state: target.state }] : []),
  });
}

/** The completed artifact stays at the domain boundary; presentation receives no evidence. */
export function completedContinuousTargetFeedback(evaluation: CompletedContinuousEvaluation): ContinuousTargetFeedback {
  return projectContinuousTargetFeedback(evaluation.status === 'UNAVAILABLE' ? []
    : evaluation.assignment.groups.flatMap(group => group.strikes));
}
