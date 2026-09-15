import type { ExpectedPracticeGroup, PracticeScoreArtifact, PracticeScope } from './artifact';
import { resolvePracticeScope } from './artifact';
import type {
  PerformanceEvaluationObservation,
  PerformanceExpectedEventOutcome,
  PerformanceExpectedStrikeOutcome,
} from './evidence';
import { PerformanceTimeline } from './performance-runtime';

const DEFAULT_ASSIGNMENT_WINDOW_MS = 250;
const DEFAULT_CHORD_SIMULTANEITY_WINDOW_MS = 120;

export type ExpectedPerformanceEvent = {
  expectedGroup: ExpectedPracticeGroup;
  performanceTimeMs: number;
};

export type PerformanceEvaluatorOptions = {
  artifact: PracticeScoreArtifact;
  timeline: PerformanceTimeline;
  scope?: PracticeScope;
  assignmentWindowMs?: number;
  chordSimultaneityWindowMs?: number;
};

export class LocalPerformanceEvaluator {
  private readonly expectedEvents: ExpectedPerformanceEvent[];
  private readonly assignmentWindowMs: number;
  private readonly chordSimultaneityWindowMs: number;

  constructor(options: PerformanceEvaluatorOptions) {
    this.assignmentWindowMs = options.assignmentWindowMs ?? DEFAULT_ASSIGNMENT_WINDOW_MS;
    this.chordSimultaneityWindowMs = options.chordSimultaneityWindowMs ?? DEFAULT_CHORD_SIMULTANEITY_WINDOW_MS;
    const scope = resolvePracticeScope(options.artifact, options.scope);
    this.expectedEvents = options.artifact.expectedPracticeGroups
      .slice(scope.startIndex, scope.endIndex + 1)
      .map((group) => ({
        expectedGroup: group,
        performanceTimeMs: options.timeline.beatToTimeMs(group.onsetBeat) - options.timeline.beatToTimeMs(scope.startBeat),
      }));
  }

  evaluate(
    observations: readonly PerformanceEvaluationObservation[]
  ): PerformanceExpectedEventOutcome[] {
    const assignments = new Map<string, PerformanceEvaluationObservation[]>();
    for (const event of this.expectedEvents) {
      assignments.set(event.expectedGroup.groupId, []);
    }
    for (const observation of observations) {
      if (!observation.pitches.length) {
        continue;
      }
      const nearest = nearestEventWithinWindow(
        this.expectedEvents,
        observation,
        this.assignmentWindowMs
      );
      if (nearest) {
        assignments.get(nearest.expectedGroup.groupId)?.push(observation);
      }
    }
    return this.expectedEvents.map((event) => outcomeForEvent(
      event,
      assignments.get(event.expectedGroup.groupId) ?? [],
      this.chordSimultaneityWindowMs
    ));
  }
}

function outcomeForEvent(
  event: ExpectedPerformanceEvent,
  observations: readonly PerformanceEvaluationObservation[],
  chordSimultaneityWindowMs: number
): PerformanceExpectedEventOutcome {
  if (!observations.length) {
    return {
      expectedGroupId: event.expectedGroup.groupId,
      performanceTimeMs: event.performanceTimeMs,
      result: 'NOT_OBSERVED',
      confidence: 0,
      source: 'FAKE',
      expectedStrikeOutcomes: event.expectedGroup.strikeTargets.map((strike) => ({
        strikeId: strike.strikeId,
        pitch: strike.pitch,
        renderNoteIds: strike.renderNoteIds,
        result: 'UNCONFIRMED',
      })),
      unexpectedPitches: [],
      renderNoteIds: event.expectedGroup.renderNoteIds,
      measureNumbers: event.expectedGroup.measureNumbers,
    };
  }

  const { gesture, nonGesture } = splitChordGestureObservations(observations, chordSimultaneityWindowMs);
  const observedPitches = gesture.flatMap((observation) => observation.pitches);
  const nonGestureClassification = classifyNonGesturePitches(
    event.expectedGroup,
    nonGesture.flatMap((observation) => observation.pitches),
    observedPitches
  );
  const expectedStrikeOutcomes = expectedStrikeOutcomesFor(
    event.expectedGroup,
    observedPitches,
    nonGestureClassification.unconfirmedExpectedPitches
  );
  const unexpectedPitches = [
    ...unexpectedPitchesFor(event.expectedGroup, observedPitches),
    ...nonGestureClassification.unexpectedPitches,
  ];
  const allMatched = expectedStrikeOutcomes.every((strike) => strike.result === 'MATCHED');
  const anyMatched = expectedStrikeOutcomes.some((strike) => strike.result === 'MATCHED');
  const result = allMatched && unexpectedPitches.length === 0
    ? 'MATCH'
    : anyMatched && unexpectedPitches.length === 0
      ? 'PARTIAL'
      : 'MISMATCH';
  return {
    expectedGroupId: event.expectedGroup.groupId,
    performanceTimeMs: event.performanceTimeMs,
    result,
    confidence: round3(average(gesture.map((observation) => observation.confidence))),
    source: gesture[0]?.source ?? 'FAKE',
    expectedStrikeOutcomes,
    unexpectedPitches,
    renderNoteIds: event.expectedGroup.renderNoteIds,
    measureNumbers: event.expectedGroup.measureNumbers,
    timingOffsetMs: round3(average(
      gesture.map((observation) => observation.performanceTimeMs - event.performanceTimeMs)
    )),
  };
}

function nearestEventWithinWindow(
  events: readonly ExpectedPerformanceEvent[],
  observation: PerformanceEvaluationObservation,
  assignmentWindowMs: number
): ExpectedPerformanceEvent | null {
  if (!events.length) {
    return null;
  }
  const nearest = events.reduce((best, event) => (
    Math.abs(event.performanceTimeMs - observation.performanceTimeMs)
      < Math.abs(best.performanceTimeMs - observation.performanceTimeMs)
      ? event
      : best
  ));
  return Math.abs(nearest.performanceTimeMs - observation.performanceTimeMs) <= assignmentWindowMs
    ? nearest
    : null;
}

function splitChordGestureObservations(
  observations: readonly PerformanceEvaluationObservation[],
  chordSimultaneityWindowMs: number
): {
  gesture: PerformanceEvaluationObservation[];
  nonGesture: PerformanceEvaluationObservation[];
} {
  const ordered = [...observations].sort((a, b) => a.performanceTimeMs - b.performanceTimeMs);
  const first = ordered[0];
  if (!first) {
    return { gesture: [], nonGesture: [] };
  }
  const gesture: PerformanceEvaluationObservation[] = [];
  const nonGesture: PerformanceEvaluationObservation[] = [];
  for (const observation of ordered) {
    if (observation.performanceTimeMs - first.performanceTimeMs <= chordSimultaneityWindowMs) {
      gesture.push(observation);
    } else {
      nonGesture.push(observation);
    }
  }
  return { gesture, nonGesture };
}

function expectedStrikeOutcomesFor(
  group: ExpectedPracticeGroup,
  observedPitches: readonly string[],
  unconfirmedExpectedPitches: readonly string[]
): PerformanceExpectedStrikeOutcome[] {
  const observed = new Set(observedPitches);
  const unconfirmed = new Set(unconfirmedExpectedPitches);
  return group.strikeTargets.map((strike) => ({
    strikeId: strike.strikeId,
    pitch: strike.pitch,
    renderNoteIds: strike.renderNoteIds,
    result: observed.has(strike.pitch)
      ? 'MATCHED'
      : unconfirmed.has(strike.pitch)
        ? 'UNCONFIRMED'
        : 'MISSING',
  }));
}

function unexpectedPitchesFor(
  group: ExpectedPracticeGroup,
  observedPitches: readonly string[]
): string[] {
  const expected = new Set(group.strikeTargets.map((strike) => strike.pitch));
  const seenExpected = new Set<string>();
  const unexpected: string[] = [];
  for (const pitch of observedPitches) {
    if (!expected.has(pitch)) {
      unexpected.push(pitch);
      continue;
    }
    if (seenExpected.has(pitch)) {
      unexpected.push(pitch);
      continue;
    }
    seenExpected.add(pitch);
  }
  return unexpected;
}

function classifyNonGesturePitches(
  group: ExpectedPracticeGroup,
  observedPitches: readonly string[],
  matchedGesturePitches: readonly string[]
): {
  unconfirmedExpectedPitches: string[];
  unexpectedPitches: string[];
} {
  const expected = new Set(group.strikeTargets.map((strike) => strike.pitch));
  const matched = new Set(matchedGesturePitches);
  const unconfirmedExpectedPitches: string[] = [];
  const unexpectedPitches: string[] = [];
  for (const pitch of observedPitches) {
    if (!expected.has(pitch) || matched.has(pitch)) {
      unexpectedPitches.push(pitch);
      continue;
    }
    if (!unconfirmedExpectedPitches.includes(pitch)) {
      unconfirmedExpectedPitches.push(pitch);
    }
  }
  return { unconfirmedExpectedPitches, unexpectedPitches };
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
