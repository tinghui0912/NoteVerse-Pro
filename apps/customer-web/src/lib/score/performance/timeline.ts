import type { BrowserPerformancePlan, PerformanceOccurrence } from './plan';
import { Rational } from './rational';
import { createPerformanceTimeMapper } from './time';
import {
  readWrittenRealization,
  type WrittenPlaybackNote,
  type WrittenVisualOnset,
} from './written-realization';

export type ScorePlaybackNote = Readonly<{
  identity: string;
  occurrenceOrdinal: number;
  sourceTrackIdentity: number;
  performanceStart: Rational;
  performanceEnd: Rational;
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  instrument: string;
}>;

export type ScoreVisualEvent = Readonly<{
  index: number;
  performancePosition: Rational;
  occurrenceOrdinal: number;
  time: number;
  noteIds: readonly string[];
}>;

export type ScorePerformanceTimeline = Readonly<{
  referenceTempoBpm: number;
  duration: number;
  notes: readonly ScorePlaybackNote[];
  visualEvents: readonly ScoreVisualEvent[];
  instruments: readonly string[];
}>;

function containsOnset(occurrence: PerformanceOccurrence, onset: Rational) {
  return (
    onset.compare(occurrence.writtenStart) >= 0 &&
    onset.compare(occurrence.writtenEnd) < 0
  );
}

function projectPosition(
  occurrence: PerformanceOccurrence,
  position: Rational
) {
  return occurrence.performanceStart.add(
    position.subtract(occurrence.writtenStart)
  );
}

export function projectScorePerformanceTimeline(
  plan: BrowserPerformancePlan,
  writtenNotes: readonly WrittenPlaybackNote[],
  visualOnsets: readonly WrittenVisualOnset[]
): ScorePerformanceTimeline {
  const mapper = createPerformanceTimeMapper(plan);
  const notes: ScorePlaybackNote[] = [];
  const visualEvents: ScoreVisualEvent[] = [];
  for (const [index, occurrence] of plan.occurrences.entries()) {
    let runEnd = occurrence.writtenEnd;
    let previous = occurrence;
    for (
      let nextIndex = index + 1;
      nextIndex < plan.occurrences.length;
      nextIndex++
    ) {
      const next = plan.occurrences[nextIndex];
      if (
        next.measureIndex !== previous.measureIndex + 1 ||
        next.writtenStart.compare(previous.writtenEnd) !== 0
      )
        break;
      runEnd = next.writtenEnd;
      previous = next;
    }
    for (const note of writtenNotes) {
      if (note.writtenEnd.compare(note.writtenStart) <= 0)
        throw new Error('Invalid written note interval.');
      if (!containsOnset(occurrence, note.writtenStart)) continue;
      const end =
        note.writtenEnd.compare(runEnd) < 0 ? note.writtenEnd : runEnd;
      const performanceStart = projectPosition(occurrence, note.writtenStart);
      const performanceEnd = projectPosition(occurrence, end);
      const time = mapper.performanceQuarterToExactSeconds(performanceStart);
      notes.push(
        Object.freeze({
          identity: `${note.identity}@${occurrence.ordinal}`,
          occurrenceOrdinal: occurrence.ordinal,
          sourceTrackIdentity: note.sourceTrackIdentity,
          performanceStart,
          performanceEnd,
          midi: note.midi,
          velocity: note.velocity,
          instrument: note.instrument,
          time: time.toNumber(),
          duration: mapper
            .performanceQuarterToExactSeconds(performanceEnd)
            .subtract(time)
            .toNumber(),
        })
      );
    }
    const simultaneous = new Map<
      string,
      { position: Rational; ids: Set<string> }
    >();
    for (const onset of visualOnsets) {
      if (!containsOnset(occurrence, onset.position)) continue;
      const position = projectPosition(occurrence, onset.position);
      const key = `${position.numerator}/${position.denominator}`;
      const event = simultaneous.get(key) ?? {
        position,
        ids: new Set<string>(),
      };
      onset.noteIds.forEach((id) => event.ids.add(id));
      simultaneous.set(key, event);
    }
    for (const event of simultaneous.values()) {
      visualEvents.push({
        index: 0,
        performancePosition: event.position,
        occurrenceOrdinal: occurrence.ordinal,
        time: mapper.performanceQuarterToSeconds(event.position),
        noteIds: Object.freeze([...event.ids]),
      });
    }
  }
  notes.sort((a, b) => a.performanceStart.compare(b.performanceStart));
  visualEvents.sort((a, b) =>
    a.performancePosition.compare(b.performancePosition)
  );
  return Object.freeze({
    referenceTempoBpm: mapper.effectiveOriginTempoBpm,
    duration: mapper.performanceEndSeconds,
    notes: Object.freeze(notes),
    visualEvents: Object.freeze(
      visualEvents.map((event, index) => Object.freeze({ ...event, index }))
    ),
    instruments: Object.freeze([
      ...new Set(notes.map((note) => note.instrument)),
    ]),
  });
}

export function createScorePerformanceTimeline(
  plan: BrowserPerformancePlan,
  midiBase64: string,
  timemap: readonly Record<string, unknown>[]
) {
  const written = readWrittenRealization(midiBase64, timemap);
  return projectScorePerformanceTimeline(
    plan,
    written.notes,
    written.visualOnsets
  );
}

export function findVisualEventAtTime(
  timeline: ScorePerformanceTimeline,
  time: number
): ScoreVisualEvent | null {
  let low = 0;
  let high = timeline.visualEvents.length - 1;
  let match = timeline.visualEvents[0] ?? null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const event = timeline.visualEvents[middle];
    if (event.time <= time) {
      match = event;
      low = middle + 1;
    } else high = middle - 1;
  }
  return match;
}
