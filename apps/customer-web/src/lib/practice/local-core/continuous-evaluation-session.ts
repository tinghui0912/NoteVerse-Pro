import type { ExpectedPracticeGroup, PracticeScoreArtifact, PracticeScope } from './artifact';
import { resolvePracticeScope, type ResolvedPracticeScope } from './artifact';
import type {
  PerformanceEvaluationObservation,
  PerformanceExpectedEventOutcome,
} from './evidence';
import {
  reconcilePerformance,
  type ExpectedStrike,
  type ReconciledStrike,
} from '../audio-analysis/continuous/performance-reconciler';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';

const DEFAULT_ASSIGNMENT_WINDOW_MS = 250;

export type PerformanceCoverageInterval = {
  startMs: number;
  endMs: number;
};

type ContinuousEvaluationClock = {
  beatToTimeMs(beat: number): number;
};

export type ContinuousEvaluationSessionOptions = {
  artifact: PracticeScoreArtifact;
  timeline: ContinuousEvaluationClock;
  scope: PracticeScope;
  assignmentWindowMs?: number;
};

export class ContinuousEvaluationSession {
  private readonly expectedEvents: ExpectedPerformanceEvent[];
  private readonly expectedStrikes: ExpectedStrike[];
  private readonly assignmentWindowMs: number;

  constructor(options: ContinuousEvaluationSessionOptions) {
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.assignmentWindowMs = options.assignmentWindowMs ?? DEFAULT_ASSIGNMENT_WINDOW_MS;
    this.expectedEvents = buildExpectedEvents(options.artifact, options.timeline, scope);
    this.expectedStrikes = this.expectedEvents.flatMap((event) =>
      event.group.strikeTargets.map((strike) => ({
        strikeId: strike.strikeId,
        groupId: event.group.groupId,
        pitch: strike.pitch,
        expectedPerformanceTimeMs: event.performanceTimeMs,
        renderNoteIds: strike.renderNoteIds,
      }))
    );
  }

  evaluate(input: {
    observations: readonly PerformanceEvaluationObservation[];
    analyzedThroughPerformanceMs: number;
    coveredPerformanceIntervals?: readonly PerformanceCoverageInterval[];
    completion:
      | { kind: 'LIVE' }
      | { kind: 'NATURAL'; terminalPerformanceMs: number }
      | { kind: 'MANUAL'; stoppedAtPerformanceMs: number };
  }): PerformanceExpectedEventOutcome[] {
    const attacks = attacksFromObservations(input.observations);
    const reconciliation = reconcilePerformance({
      expectedStrikes: this.expectedStrikes,
      observedAttacks: attacks,
      analyzedThroughPerformanceMs: 0,
      assignmentWindowMs: this.assignmentWindowMs,
      completion: input.completion,
    });
    const coveredPerformanceIntervals = input.coveredPerformanceIntervals ?? [
      { startMs: 0, endMs: input.analyzedThroughPerformanceMs },
    ];
    return this.expectedEvents.map((event) =>
      outcomeForEvent({
        event,
        strikes: reconciliation.strikes.filter((strike) => strike.groupId === event.group.groupId),
        extras: extrasForEvent({
          event,
          extras: reconciliation.extras,
          assignmentWindowMs: this.assignmentWindowMs,
        }),
        attacksById: new Map(
          attacks.map((attack) => [attack.observationId, attack])
        ),
        assignmentWindowMs: this.assignmentWindowMs,
        coveredPerformanceIntervals,
        completion: input.completion,
      })
    );
  }
}

type ExpectedPerformanceEvent = {
  group: ExpectedPracticeGroup;
  performanceTimeMs: number;
};

function buildExpectedEvents(
  artifact: PracticeScoreArtifact,
  timeline: ContinuousEvaluationClock,
  scope: ResolvedPracticeScope
): ExpectedPerformanceEvent[] {
  const scopeStartTimeMs = timeline.beatToTimeMs(scope.startBeat);
  return artifact.expectedPracticeGroups
    .slice(scope.startIndex, scope.endIndex + 1)
    .map((group) => ({
      group,
      performanceTimeMs: timeline.beatToTimeMs(group.onsetBeat) - scopeStartTimeMs,
    }));
}

function attacksFromObservations(
  observations: readonly PerformanceEvaluationObservation[]
): ObservedAttack[] {
  return observations.flatMap((observation, observationIndex) =>
    observation.pitches.map((pitch, pitchIndex) => ({
      observationId: `${observationIndex}:${pitchIndex}:${pitch}:${observation.performanceTimeMs}`,
      pitch,
      performanceTimeMs: observation.performanceTimeMs,
      confidence: observation.confidence,
      source: observation.source,
    }))
  );
}

function outcomeForEvent(input: {
  event: ExpectedPerformanceEvent;
  strikes: readonly ReconciledStrike[];
  extras: readonly ObservedAttack[];
  attacksById: ReadonlyMap<string, ObservedAttack>;
  assignmentWindowMs: number;
  coveredPerformanceIntervals: readonly PerformanceCoverageInterval[];
  completion:
    | { kind: 'LIVE' }
    | { kind: 'NATURAL'; terminalPerformanceMs: number }
    | { kind: 'MANUAL'; stoppedAtPerformanceMs: number };
}): PerformanceExpectedEventOutcome {
  const expectedStrikeOutcomes = input.strikes.map((strike) => ({
    strikeId: strike.strikeId,
    pitch: strike.pitch,
    renderNoteIds: [...strike.renderNoteIds],
    result: strikeResult({
      strike,
      assignmentWindowMs: input.assignmentWindowMs,
      coveredPerformanceIntervals: input.coveredPerformanceIntervals,
      completion: input.completion,
    }),
  }));
  const matchedStrikes = input.strikes.filter((strike) => strike.verdict === 'MATCHED');
  const allMatched = expectedStrikeOutcomes.length > 0
    && expectedStrikeOutcomes.every((strike) => strike.result === 'MATCHED');
  const anyMatched = matchedStrikes.length > 0;
  const unexpectedPitches = input.extras.map((attack) => attack.pitch);
  const matchedAttacks = matchedStrikes
    .map((strike) => strike.matchedObservationId ? input.attacksById.get(strike.matchedObservationId) : undefined)
    .filter((attack): attack is ObservedAttack => Boolean(attack));
  return {
    expectedGroupId: input.event.group.groupId,
    performanceTimeMs: input.event.performanceTimeMs,
    result: unexpectedPitches.length > 0
      ? 'MISMATCH'
      : allMatched
        ? 'MATCH'
        : anyMatched
          ? 'PARTIAL'
          : expectedStrikeOutcomes.some((strike) => strike.result === 'MISSING')
          ? 'MISMATCH'
          : 'NOT_OBSERVED',
    confidence: round3(average(matchedAttacks.map((attack) => attack.confidence))),
    source: matchedAttacks[0]?.source ?? input.extras[0]?.source ?? 'FAKE',
    expectedStrikeOutcomes,
    unexpectedPitches,
    renderNoteIds: input.event.group.renderNoteIds,
    measureNumbers: input.event.group.measureNumbers,
    timingOffsetMs: matchedStrikes.length > 0
      ? round3(average(matchedStrikes.map((strike) => strike.timingOffsetMs ?? 0)))
      : undefined,
  };
}

function strikeResult(input: {
  strike: ReconciledStrike;
  assignmentWindowMs: number;
  coveredPerformanceIntervals: readonly PerformanceCoverageInterval[];
  completion:
    | { kind: 'LIVE' }
    | { kind: 'NATURAL'; terminalPerformanceMs: number }
    | { kind: 'MANUAL'; stoppedAtPerformanceMs: number };
}): 'MATCHED' | 'MISSING' | 'UNCONFIRMED' {
  if (input.strike.verdict === 'MATCHED') {
    return 'MATCHED';
  }
  if (input.strike.verdict === 'NOT_REACHED') {
    return 'UNCONFIRMED';
  }
  const windowStartMs = Math.max(0, input.strike.expectedPerformanceTimeMs - input.assignmentWindowMs);
  const unclippedWindowEndMs = input.strike.expectedPerformanceTimeMs + input.assignmentWindowMs;
  if (
    input.completion.kind === 'MANUAL' &&
    unclippedWindowEndMs > input.completion.stoppedAtPerformanceMs
  ) {
    return 'UNCONFIRMED';
  }
  const windowEndMs = input.completion.kind === 'NATURAL'
    ? Math.min(unclippedWindowEndMs, input.completion.terminalPerformanceMs)
    : unclippedWindowEndMs;
  return isIntervalFullyCovered(input.coveredPerformanceIntervals, windowStartMs, windowEndMs)
    ? 'MISSING'
    : 'UNCONFIRMED';
}

function isIntervalFullyCovered(
  intervals: readonly PerformanceCoverageInterval[],
  startMs: number,
  endMs: number
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return false;
  }
  let cursor = startMs;
  for (const interval of intervals) {
    if (interval.endMs < cursor) {
      continue;
    }
    if (interval.startMs > cursor) {
      return false;
    }
    cursor = Math.max(cursor, interval.endMs);
    if (cursor >= endMs) {
      return true;
    }
  }
  return cursor >= endMs;
}

function extrasForEvent(input: {
  event: ExpectedPerformanceEvent;
  extras: readonly ObservedAttack[];
  assignmentWindowMs: number;
}): ObservedAttack[] {
  return input.extras.filter((attack) =>
    Math.abs(attack.performanceTimeMs - input.event.performanceTimeMs) <= input.assignmentWindowMs
  );
}

function average(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
