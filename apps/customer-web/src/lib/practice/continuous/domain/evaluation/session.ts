import { buildContinuousExpectedStrikesFromTimeline } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import { ContinuousFinalizer } from '@/lib/practice/continuous/domain/evaluation/finalizer';
import type { ContinuousCompletion, ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/types';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: PracticeScope;
  sessionDomainId: string;
};

export class ContinuousEvaluationSession {
  private readonly finalizer: ContinuousFinalizer;

  constructor(options: ContinuousEvaluationSessionOptions) {
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.finalizer = new ContinuousFinalizer(options.sessionDomainId,
      buildContinuousExpectedStrikesFromTimeline(options.artifact, options.timeline, scope));
  }

  publish(publication: ContinuousEvidencePublication) { return this.finalizer.publish(publication); }
  complete(completion: ContinuousCompletion) { return this.finalizer.complete(completion); }
  snapshot() { return this.finalizer.snapshot(); }
  completedEvaluation() { return this.finalizer.completedEvaluation(); }
}
