import { resolvePracticeScope, type PracticeScoreArtifact, type PracticeScope } from './artifact';
import { ContinuousFinalizer } from './continuous-finalizer';
import { buildContinuousExpectedStrikesFromTimeline } from './continuous-expected-strikes';
import type { ContinuousCompletion, ContinuousEvidencePublication } from './continuous-evaluation-types';

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
