import type { ObservedAttack } from './event-stitcher';

export type ExpectedStrike = {
  strikeId: string;
  groupId: string;
  pitch: string;
  expectedPerformanceTimeMs: number;
  renderNoteIds: readonly string[];
};

export type StrikeVerdict = 'PENDING' | 'MATCHED' | 'MISSING' | 'NOT_REACHED';

export type ReconciledStrike = ExpectedStrike & {
  verdict: StrikeVerdict;
  matchedObservationId?: string;
  timingOffsetMs?: number;
};

export type ReconciliationResult = {
  strikes: readonly ReconciledStrike[];
  extras: readonly ObservedAttack[];
};

type CandidateEdge = {
  strikeIndex: number;
  observationIndex: number;
  absoluteTimingErrorMs: number;
};

export function reconcilePerformance(input: {
  expectedStrikes: readonly ExpectedStrike[];
  observedAttacks: readonly ObservedAttack[];
  analyzedThroughPerformanceMs: number;
  assignmentWindowMs: number;
  completion:
    | { kind: 'LIVE' }
    | { kind: 'NATURAL'; terminalPerformanceMs: number }
    | { kind: 'MANUAL'; stoppedAtPerformanceMs: number };
}): ReconciliationResult {
  if (input.assignmentWindowMs < 0) {
    throw new Error('Assignment window must be non-negative.');
  }
  const edges = buildCandidateEdges(input);
  const assignedStrikes = new Map<number, number>();
  const assignedObservations = new Set<number>();
  for (const edge of edges) {
    if (assignedStrikes.has(edge.strikeIndex) || assignedObservations.has(edge.observationIndex)) {
      continue;
    }
    assignedStrikes.set(edge.strikeIndex, edge.observationIndex);
    assignedObservations.add(edge.observationIndex);
  }

  const strikes = input.expectedStrikes.map((strike, strikeIndex): ReconciledStrike => {
    const observationIndex = assignedStrikes.get(strikeIndex);
    if (observationIndex !== undefined) {
      const observation = input.observedAttacks[observationIndex];
      return {
        ...strike,
        verdict: 'MATCHED',
        matchedObservationId: observation.observationId,
        timingOffsetMs: observation.performanceTimeMs - strike.expectedPerformanceTimeMs,
      };
    }
    const deadline = strike.expectedPerformanceTimeMs + input.assignmentWindowMs;
    if (input.completion.kind === 'MANUAL' && deadline > input.completion.stoppedAtPerformanceMs) {
      return { ...strike, verdict: 'NOT_REACHED' };
    }
    const analyzedDeadline = input.completion.kind === 'NATURAL'
      ? Math.min(deadline, input.completion.terminalPerformanceMs)
      : deadline;
    if (input.analyzedThroughPerformanceMs >= analyzedDeadline) {
      return { ...strike, verdict: 'MISSING' };
    }
    return { ...strike, verdict: 'PENDING' };
  });

  const extras = input.observedAttacks.filter((_, observationIndex) => !assignedObservations.has(observationIndex));
  return { strikes, extras };
}

function buildCandidateEdges(input: {
  expectedStrikes: readonly ExpectedStrike[];
  observedAttacks: readonly ObservedAttack[];
  assignmentWindowMs: number;
}): CandidateEdge[] {
  const edges: CandidateEdge[] = [];
  input.expectedStrikes.forEach((strike, strikeIndex) => {
    input.observedAttacks.forEach((observation, observationIndex) => {
      if (observation.pitch !== strike.pitch) {
        return;
      }
      const timingError = observation.performanceTimeMs - strike.expectedPerformanceTimeMs;
      const absoluteTimingErrorMs = Math.abs(timingError);
      if (absoluteTimingErrorMs > input.assignmentWindowMs) {
        return;
      }
      edges.push({ strikeIndex, observationIndex, absoluteTimingErrorMs });
    });
  });
  return edges.sort((left, right) => (
    left.absoluteTimingErrorMs - right.absoluteTimingErrorMs
      || left.strikeIndex - right.strikeIndex
      || left.observationIndex - right.observationIndex
  ));
}
