import { projectContinuousTargetFeedback, type ContinuousTargetFeedback } from './target-feedback';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import { buildContinuousExpectedStrikesFromTimeline } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousCompletion } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousEvaluationSnapshot, CompletedContinuousEvaluation, ContinuousEvaluationUnavailableReason, UnavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: Readonly<ResolvedPracticeScope>;
  sessionDomainId: string;
  inputSource: PracticeInputSource;
};

export class ContinuousEvaluationSession {
  private failure: Error | null = null;
  private readonly inputSource: PracticeInputSource;
  private readonly finalizer: ContinuousAssignmentFinalizer;

  constructor(options: ContinuousEvaluationSessionOptions) {
    this.inputSource = options.inputSource;
    this.finalizer = new ContinuousAssignmentFinalizer(options.sessionDomainId,
      buildContinuousExpectedStrikesFromTimeline(options.artifact, options.timeline, options.scope));
  }

  publish(publication: ContinuousEvidencePublication): void {
    if (this.failure) throw this.failure;
    if (Array.isArray(publication.observations) && publication.observations.some(observation => observation.source !== (this.inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC'))) {
      this.failure = new ContinuousEvaluationError('OBSERVATION_SOURCE_MISMATCH');
      throw this.failure;
    }
    this.finalizer.publish(publication);
    return;
  }
  complete(completion: ContinuousCompletion): void {
    if (this.failure) throw this.failure;
    this.finalizer.complete(completion);
    return;
  }
  targetFeedback(): ContinuousTargetFeedback { return projectContinuousTargetFeedback(this.finalizer.targetStates()); }
  snapshot(): ContinuousEvaluationSnapshot { return immutableContinuousValue({ assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource: this.inputSource, assignment: this.finalizer.snapshot() }); }
  nextRequiredAnalysisFrontier(): number | null { return this.finalizer.nextRequiredAnalysisFrontier(); }
  completedEvaluation(): CompletedContinuousEvaluation {
    if (this.failure) return unavailableContinuousEvaluation(this.inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE');
    const result = this.finalizer.completedAssignment();
    return result.status === 'UNAVAILABLE' ? unavailableContinuousEvaluation(this.inputSource, result.reason)
      : immutableContinuousValue({ status: 'COMPLETE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource: this.inputSource, assignment: result.assignment });
  }
}

export function unavailableContinuousEvaluation(inputSource: PracticeInputSource, reason: ContinuousEvaluationUnavailableReason): UnavailableContinuousEvaluation {
  return Object.freeze({ status: 'UNAVAILABLE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource, reason });
}

export function assertCompletedEvaluation(evaluation: CompletedContinuousEvaluation, inputSource: PracticeInputSource): void {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) throw new Error('Continuous evaluation shape is corrupt.');
  const fields = evaluation.status === 'COMPLETE'
    ? ['status', 'inputSource', 'assignmentPolicyId', 'assignment']
    : ['status', 'inputSource', 'assignmentPolicyId', 'reason'];
  if (Object.keys(evaluation).sort().join() !== fields.sort().join()) throw new Error('Continuous evaluation shape is corrupt.');
  if (evaluation.assignmentPolicyId !== CONTINUOUS_ASSIGNMENT_POLICY_ID) throw new Error('Continuous assignment policy identity is corrupt.');
  if (!['MIDI', 'MICROPHONE'].includes(inputSource) || evaluation.inputSource !== inputSource) {
    throw new Error('Continuous evaluation input source is corrupt.');
  }
  if (evaluation.status === 'UNAVAILABLE') {
    if (!['CONTINUOUS_ANALYSIS_UNAVAILABLE', 'INCOMPLETE_ANALYSIS'].includes(evaluation.reason)) {
      throw new Error('Continuous evaluation unavailable reason is corrupt.');
    }
    return;
  }
  if (evaluation.status !== 'COMPLETE') throw new Error('Continuous evaluation status is corrupt.');
  assertCompletedAssignment(evaluation.assignment);
  if (evaluation.assignment.observations.some(observation => observation.source !== (inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC'))) {
    throw new ContinuousEvaluationError('OBSERVATION_SOURCE_MISMATCH');
  }
}
