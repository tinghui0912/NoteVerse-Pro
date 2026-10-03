import type { ObservedAttack } from './observed-attack';

export type ExpectedStrike = {
  strikeId: string;
  groupId: string;
  pitch: string;
  expectedPerformanceTimeMs: number;
  renderNoteIds: readonly string[];
};

type StrikeVerdict = 'PENDING' | 'MATCHED' | 'MISSING' | 'NOT_REACHED';

export type ReconciledStrike = ExpectedStrike & {
  verdict: StrikeVerdict;
  matchedObservationId?: string;
  timingOffsetMs?: number;
};

export type ReconciliationResult = {
  strikes: readonly ReconciledStrike[];
  extras: readonly ObservedAttack[];
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
  const assignedStrikes = buildOptimalAssignments(input);
  const assignedObservations = new Set(assignedStrikes.values());

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

function buildOptimalAssignments(input: {
  expectedStrikes: readonly ExpectedStrike[];
  observedAttacks: readonly ObservedAttack[];
  assignmentWindowMs: number;
}): Map<number, number> {
  const assignments = new Map<number, number>();
  const expectedByPitch = new Map<string, number[]>();
  const observedByPitch = new Map<string, number[]>();
  input.expectedStrikes.forEach((strike, strikeIndex) => {
    const list = expectedByPitch.get(strike.pitch) ?? [];
    list.push(strikeIndex);
    expectedByPitch.set(strike.pitch, list);
  });
  input.observedAttacks.forEach((attack, observationIndex) => {
    const list = observedByPitch.get(attack.pitch) ?? [];
    list.push(observationIndex);
    observedByPitch.set(attack.pitch, list);
  });
  for (const [pitch, strikeIndices] of expectedByPitch) {
    const observationIndices = observedByPitch.get(pitch) ?? [];
    if (observationIndices.length === 0) {
      continue;
    }
    const pitchAssignments = solvePitchAssignments({
      strikeIndices: strikeIndices.slice().sort((left, right) =>
        input.expectedStrikes[left].expectedPerformanceTimeMs - input.expectedStrikes[right].expectedPerformanceTimeMs
          || left - right
      ),
      observationIndices: observationIndices.slice().sort((left, right) =>
        input.observedAttacks[left].performanceTimeMs - input.observedAttacks[right].performanceTimeMs
          || left - right
      ),
      expectedStrikes: input.expectedStrikes,
      observedAttacks: input.observedAttacks,
      assignmentWindowMs: input.assignmentWindowMs,
    });
    for (const [strikeIndex, observationIndex] of pitchAssignments) {
      assignments.set(strikeIndex, observationIndex);
    }
  }
  return assignments;
}

type PitchAssignmentInput = {
  strikeIndices: readonly number[];
  observationIndices: readonly number[];
  expectedStrikes: readonly ExpectedStrike[];
  observedAttacks: readonly ObservedAttack[];
  assignmentWindowMs: number;
};

type AssignmentScore = {
  matchCount: number;
  totalTimingErrorMs: number;
  pairs: readonly (readonly [number, number])[];
};

function solvePitchAssignments(input: PitchAssignmentInput): readonly (readonly [number, number])[] {
  const rows = input.strikeIndices.length;
  const columns = input.observationIndices.length;
  const table: AssignmentScore[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: columns + 1 }, () => emptyScore())
  );
  for (let strikeOffset = rows - 1; strikeOffset >= 0; strikeOffset -= 1) {
    for (let observationOffset = columns - 1; observationOffset >= 0; observationOffset -= 1) {
      const skipStrike = table[strikeOffset + 1][observationOffset];
      const skipObservation = table[strikeOffset][observationOffset + 1];
      const candidates = [skipStrike, skipObservation];
      const match = matchScore(input, strikeOffset, observationOffset, table[strikeOffset + 1][observationOffset + 1]);
      if (match) {
        candidates.push(match);
      }
      table[strikeOffset][observationOffset] = candidates.reduce(bestScore);
    }
  }
  return table[0][0].pairs;
}

function matchScore(
  input: PitchAssignmentInput,
  strikeOffset: number,
  observationOffset: number,
  tail: AssignmentScore
): AssignmentScore | null {
  const strikeIndex = input.strikeIndices[strikeOffset];
  const observationIndex = input.observationIndices[observationOffset];
  const strike = input.expectedStrikes[strikeIndex];
  const observation = input.observedAttacks[observationIndex];
  const timingError = Math.abs(observation.performanceTimeMs - strike.expectedPerformanceTimeMs);
  if (timingError > input.assignmentWindowMs) {
    return null;
  }
  return {
    matchCount: tail.matchCount + 1,
    totalTimingErrorMs: tail.totalTimingErrorMs + timingError,
    pairs: [[strikeIndex, observationIndex], ...tail.pairs],
  };
}

function emptyScore(): AssignmentScore {
  return { matchCount: 0, totalTimingErrorMs: 0, pairs: [] };
}

function bestScore(left: AssignmentScore, right: AssignmentScore): AssignmentScore {
  if (right.matchCount !== left.matchCount) {
    return right.matchCount > left.matchCount ? right : left;
  }
  if (right.totalTimingErrorMs !== left.totalTimingErrorMs) {
    return right.totalTimingErrorMs < left.totalTimingErrorMs ? right : left;
  }
  return comparePairs(right.pairs, left.pairs) < 0 ? right : left;
}

function comparePairs(
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[]
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const [leftStrike, leftObservation] = left[index];
    const [rightStrike, rightObservation] = right[index];
    if (leftStrike !== rightStrike) {
      return leftStrike - rightStrike;
    }
    if (leftObservation !== rightObservation) {
      return leftObservation - rightObservation;
    }
  }
  return left.length - right.length;
}
