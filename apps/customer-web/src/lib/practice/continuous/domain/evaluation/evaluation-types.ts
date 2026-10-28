import type { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import type { ContinuousAssignmentSnapshot, CompletedContinuousAssignment } from './assignment-types';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
export type ContinuousEvaluationSnapshot = Readonly<{
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  inputSource: PracticeInputSource;
  assignment: ContinuousAssignmentSnapshot;
}>;
export type ContinuousEvaluationUnavailableReason = 'CONTINUOUS_ANALYSIS_UNAVAILABLE' | 'INCOMPLETE_ANALYSIS';
export type UnavailableContinuousEvaluation = Readonly<{
  status: 'UNAVAILABLE'; inputSource: PracticeInputSource;
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  reason: ContinuousEvaluationUnavailableReason;
}>;
export type CompletedContinuousEvaluation = Readonly<{
  status: 'COMPLETE'; inputSource: PracticeInputSource;
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  assignment: CompletedContinuousAssignment;
}> | UnavailableContinuousEvaluation;
