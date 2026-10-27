import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import { buildContinuousExpectedStrikesFromTimeline } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousCompletion, CompletedContinuousAssignment, ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousEvaluationSnapshot, CompletedContinuousEvaluation, ContinuousEvaluationLayers, ContinuousEvaluationUnavailableReason, UnavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { interpretContinuousAssignment, interpretationPolicyForInputSource } from '@/lib/practice/continuous/domain/evaluation/interpretation';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: PracticeScope;
  sessionDomainId: string;
  inputSource: PracticeInputSource;
};

export class ContinuousEvaluationSession {
  private failure: Error | null = null;
  private readonly inputSource: PracticeInputSource;
  private readonly finalizer: ContinuousAssignmentFinalizer;

  constructor(options: ContinuousEvaluationSessionOptions) {
    this.inputSource = options.inputSource;
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.finalizer = new ContinuousAssignmentFinalizer(options.sessionDomainId,
      buildContinuousExpectedStrikesFromTimeline(options.artifact, options.timeline, scope));
  }

  publish(publication: ContinuousEvidencePublication): ContinuousEvaluationSnapshot {
    if (this.failure) throw this.failure;
    if (Array.isArray(publication.observations) && publication.observations.some(observation => observation.source !== (this.inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC'))) {
      this.failure = new ContinuousEvaluationError('OBSERVATION_SOURCE_MISMATCH');
      throw this.failure;
    }
    this.finalizer.publish(publication);
    return this.snapshot();
  }
  complete(completion: ContinuousCompletion): ContinuousEvaluationSnapshot {
    if (this.failure) throw this.failure;
    this.finalizer.complete(completion);
    return this.snapshot();
  }
  snapshot(): ContinuousEvaluationSnapshot { return projectEvaluation(this.finalizer.snapshot(), this.inputSource); }
  completedEvaluation(): CompletedContinuousEvaluation {
    if (this.failure) return unavailableContinuousEvaluation(this.inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE');
    const result = this.finalizer.completedAssignment();
    return result.status === 'UNAVAILABLE' ? unavailableContinuousEvaluation(this.inputSource, result.reason)
      : immutableContinuousValue({ status: 'COMPLETE', ...projectEvaluation(result.assignment, this.inputSource) });
  }
}

function projectEvaluation<A extends ContinuousAssignmentSnapshot | CompletedContinuousAssignment>(assignment: A, inputSource: PracticeInputSource): ContinuousEvaluationLayers<A> {
  const interpretation = interpretContinuousAssignment(assignment, inputSource);
  return interpretation.inputSource === 'MIDI'
    ? immutableContinuousValue({ assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource: 'MIDI', interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', assignment, interpretation })
    : immutableContinuousValue({ assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource: 'MICROPHONE', interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', assignment, interpretation });
}
export function unavailableContinuousEvaluation(inputSource: PracticeInputSource, reason: ContinuousEvaluationUnavailableReason): UnavailableContinuousEvaluation {
  return inputSource === 'MIDI' ? Object.freeze({ status: 'UNAVAILABLE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource, interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', reason })
    : Object.freeze({ status: 'UNAVAILABLE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, inputSource, interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', reason });
}

export function assertCompletedEvaluation(evaluation: CompletedContinuousEvaluation, inputSource: PracticeInputSource): void {
  const fields = evaluation.status === 'COMPLETE'
    ? ['status', 'inputSource', 'assignmentPolicyId', 'interpretationPolicyId', 'assignment', 'interpretation']
    : ['status', 'inputSource', 'assignmentPolicyId', 'interpretationPolicyId', 'reason'];
  if (Object.keys(evaluation).sort().join() !== fields.sort().join()) throw new Error('Continuous evaluation shape is corrupt.');
  if (evaluation.assignmentPolicyId !== CONTINUOUS_ASSIGNMENT_POLICY_ID) throw new Error('Continuous assignment policy identity is corrupt.');
  if (evaluation.inputSource !== inputSource || evaluation.interpretationPolicyId !== interpretationPolicyForInputSource(inputSource)) {
    throw new Error('Continuous evaluation interpretation identity is corrupt.');
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
  // Projection freezes its output; validation must not freeze caller-owned evidence or target metadata.
  if (JSON.stringify(evaluation.interpretation) !== JSON.stringify(interpretContinuousAssignment(structuredClone(evaluation.assignment), inputSource))) {
    throw new Error('Continuous evaluation interpretation is not an assignment projection.');
  }
}
