import { resolvePracticeScope, type PracticeScoreArtifact, type PracticeScope } from './artifact';
import type { LocalPracticeCompletionReason } from './session';
import {
  ContinuousFinalizationLedger,
  type ContinuousEvaluationSnapshot,
} from './continuous-finalization-ledger';
import { buildContinuousExpectedStrikesFromTimeline } from './continuous-expected-strikes';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';
import type { CompletedContinuousEvaluation } from '../completed-performance';

export const DEFAULT_ASSIGNMENT_WINDOW_MS = 250;

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type { ContinuousEvaluationSnapshot };

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: PracticeScope;
  assignmentWindowMs?: number;
};

export class ContinuousEvaluationSession {
  private readonly ledger: ContinuousFinalizationLedger;

  constructor(options: ContinuousEvaluationSessionOptions) {
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.ledger = new ContinuousFinalizationLedger({
      expectedStrikes: buildContinuousExpectedStrikesFromTimeline(options.artifact, options.timeline, scope),
      assignmentWindowMs: options.assignmentWindowMs ?? DEFAULT_ASSIGNMENT_WINDOW_MS,
    });
  }

  observeAttack(attack: ObservedAttack): void {
    this.ledger.observeAttack(attack);
  }

  publishObservations(attacks: readonly ObservedAttack[], analyzedThroughPerformanceMs: number): void {
    this.ledger.publishObservations(attacks, analyzedThroughPerformanceMs);
  }

  advanceAnalysisThrough(performanceTimeMs: number): void {
    this.ledger.advanceAnalysisThrough(performanceTimeMs);
  }

  complete(input: {
    reason: LocalPracticeCompletionReason;
    performanceTimeMs: number;
    terminalPerformanceMs: number;
  }): void {
    this.ledger.complete(input);
  }

  snapshot(): ContinuousEvaluationSnapshot {
    return this.ledger.snapshot();
  }

  completedEvaluation(): CompletedContinuousEvaluation {
    return this.ledger.completedEvaluation();
  }
}
