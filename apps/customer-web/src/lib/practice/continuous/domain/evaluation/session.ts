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
    ? immutableContinuousValue({ inputSource: 'MIDI', policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', assignment, interpretation })
    : immutableContinuousValue({ inputSource: 'MICROPHONE', policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', assignment, interpretation });
}
export function unavailableContinuousEvaluation(inputSource: PracticeInputSource, reason: ContinuousEvaluationUnavailableReason): UnavailableContinuousEvaluation {
  return inputSource === 'MIDI' ? Object.freeze({ status: 'UNAVAILABLE', inputSource, policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', reason })
    : Object.freeze({ status: 'UNAVAILABLE', inputSource, policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', reason });
}

export function assertCompletedEvaluation(evaluation: CompletedContinuousEvaluation, inputSource: PracticeInputSource): void {
  if (evaluation.inputSource !== inputSource || evaluation.policyId !== interpretationPolicyForInputSource(inputSource)) {
    throw new Error('CompletedPerformance interpretation identity is corrupt.');
  }
  if (evaluation.status === 'UNAVAILABLE') {
    if (!['CONTINUOUS_ANALYSIS_UNAVAILABLE', 'INCOMPLETE_ANALYSIS', 'CORRUPT_TRANSIENT_DRAFT'].includes(evaluation.reason)) {
      throw new Error('CompletedPerformance unavailable reason is corrupt.');
    }
    return;
  }
  assertCompletedAssignment(evaluation.assignment);
  if (evaluation.assignment.observations.some(observation => observation.source !== (inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC'))) {
    throw new ContinuousEvaluationError('OBSERVATION_SOURCE_MISMATCH');
  }
  if (JSON.stringify(evaluation.interpretation) !== JSON.stringify(interpretContinuousAssignment(evaluation.assignment, inputSource))) {
    throw new Error('CompletedPerformance interpretation is not an assignment projection.');
  }
}
