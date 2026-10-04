import { resolvePracticeScope, type PracticeScoreArtifact, type PracticeScope, type ResolvedPracticeScope } from './artifact';
import type { LocalPracticeCompletionReason } from './session';
import {
  reconcilePerformance,
  type ExpectedStrike,
  type ReconciledStrike,
} from '../audio-analysis/continuous/performance-reconciler';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';
import type { CompletedContinuousEvaluation } from '../completed-performance';

const DEFAULT_ASSIGNMENT_WINDOW_MS = 250;

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type ContinuousEvaluationSnapshot = {
  strikes: readonly ReconciledStrike[];
  extras: readonly ObservedAttack[];
};

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: PracticeScope;
  assignmentWindowMs?: number;
};

export class ContinuousEvaluationSession {
  private readonly expectedStrikes: ExpectedStrike[];
  private readonly assignmentWindowMs: number;
  private readonly observedAttacks: ObservedAttack[] = [];
  private analyzedThroughPerformanceMs = 0;
  private completion:
    | { kind: 'LIVE' }
    | { kind: 'NATURAL'; terminalPerformanceMs: number }
    | { kind: 'MANUAL'; stoppedAtPerformanceMs: number } = { kind: 'LIVE' };

  constructor(options: ContinuousEvaluationSessionOptions) {
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.assignmentWindowMs = options.assignmentWindowMs ?? DEFAULT_ASSIGNMENT_WINDOW_MS;
    this.expectedStrikes = buildExpectedStrikes(options.artifact, options.timeline, scope);
  }

  observeAttack(attack: ObservedAttack): void {
    this.observedAttacks.push({ ...attack });
  }

  advanceAnalysisThrough(performanceTimeMs: number): void {
    if (!Number.isFinite(performanceTimeMs) || performanceTimeMs < 0) {
      throw new Error('Continuous analysis frontier must be finite and non-negative.');
    }
    this.analyzedThroughPerformanceMs = Math.max(this.analyzedThroughPerformanceMs, performanceTimeMs);
  }

  complete(input: {
    reason: LocalPracticeCompletionReason;
    performanceTimeMs: number;
    terminalPerformanceMs: number;
  }): void {
    this.completion = input.reason === 'SCOPE_COMPLETED'
      ? { kind: 'NATURAL', terminalPerformanceMs: input.terminalPerformanceMs }
      : { kind: 'MANUAL', stoppedAtPerformanceMs: input.performanceTimeMs };
  }

  snapshot(): ContinuousEvaluationSnapshot {
    return reconcilePerformance({
      expectedStrikes: this.expectedStrikes,
      observedAttacks: this.observedAttacks,
      analyzedThroughPerformanceMs: this.analyzedThroughPerformanceMs,
      assignmentWindowMs: this.assignmentWindowMs,
      completion: this.completion,
    });
  }

  completedEvaluation(): CompletedContinuousEvaluation {
    const snapshot = this.snapshot();
    if (snapshot.strikes.some((strike) => strike.verdict === 'PENDING')) {
      return { status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' };
    }
    return {
      status: 'COMPLETE',
      strikes: snapshot.strikes.map((strike) => {
        if (strike.verdict === 'MATCHED') {
          const attack = this.observedAttacks.find((item) => item.observationId === strike.matchedObservationId);
          if (!attack) {
            throw new Error('Matched strike references an unknown observed attack.');
          }
          return {
            strikeId: strike.strikeId,
            expectedGroupId: strike.groupId,
            pitch: strike.pitch,
            performanceTimeMs: strike.expectedPerformanceTimeMs,
            renderNoteIds: [...strike.renderNoteIds],
            result: 'MATCHED',
            matchedObservationId: attack.observationId,
            confidence: attack.confidence,
            source: attack.source,
            timingOffsetMs: strike.timingOffsetMs,
          };
        }
        if (strike.verdict === 'MISSING' || strike.verdict === 'NOT_REACHED') {
          return {
            strikeId: strike.strikeId,
            expectedGroupId: strike.groupId,
            pitch: strike.pitch,
            performanceTimeMs: strike.expectedPerformanceTimeMs,
            renderNoteIds: [...strike.renderNoteIds],
            result: strike.verdict,
          };
        }
        throw new Error('Pending strikes cannot be converted to completed evaluation.');
      }),
      extras: snapshot.extras.map((attack) => ({ ...attack })),
    };
  }
}

function buildExpectedStrikes(
  artifact: PracticeScoreArtifact,
  timeline: ContinuousEvaluationClock,
  scope: ResolvedPracticeScope
): ExpectedStrike[] {
  const scopeStartTimeMs = timeline.beatToTimeMs(scope.startBeat);
  return artifact.expectedPracticeGroups
    .slice(scope.startIndex, scope.endIndex + 1)
    .flatMap((group) => {
      const performanceTimeMs = timeline.beatToTimeMs(group.onsetBeat) - scopeStartTimeMs;
      return group.strikeTargets.map((strike) => ({
        strikeId: strike.strikeId,
        groupId: group.groupId,
        pitch: strike.pitch,
        expectedPerformanceTimeMs: performanceTimeMs,
        renderNoteIds: strike.renderNoteIds,
      }));
    });
}
