import type {
  PerformancePlanRead,
  PerformanceOccurrenceRead,
  PerformanceTempoEventRead,
} from '@/generated/api';
import { Rational, safeInteger, ZERO } from './rational';

export type PerformanceOccurrence = Readonly<{
  ordinal: number;
  measureIndex: number;
  visit: number;
  writtenStart: Rational;
  writtenEnd: Rational;
  performanceStart: Rational;
  performanceEnd: Rational;
}>;

type PerformanceTempoEncounter = Readonly<{
  occurrenceOrdinal: number;
  performancePosition: Rational;
  bpm: Rational;
}>;

export type BrowserPerformancePlan = Readonly<{
  musicxml: string;
  performanceEnd: Rational;
  initialTempoBpm: Rational;
  occurrences: readonly PerformanceOccurrence[];
  tempoEvents: readonly PerformanceTempoEncounter[];
}>;

function occurrence(dto: PerformanceOccurrenceRead): PerformanceOccurrence {
  const result = {
    ordinal: safeInteger(dto.ordinal),
    measureIndex: safeInteger(dto.measure_index),
    visit: safeInteger(dto.visit, 1),
    writtenStart: Rational.decode(dto.written_start),
    writtenEnd: Rational.decode(dto.written_end),
    performanceStart: Rational.decode(dto.performance_start),
    performanceEnd: Rational.decode(dto.performance_end),
  };
  if (
    result.writtenStart.compare(ZERO) < 0 ||
    result.writtenEnd.compare(result.writtenStart) < 0 ||
    result.performanceEnd.compare(result.performanceStart) < 0 ||
    result.writtenEnd
      .subtract(result.writtenStart)
      .compare(result.performanceEnd.subtract(result.performanceStart)) !== 0
  ) {
    throw new Error('Invalid performance occurrence interval.');
  }
  return Object.freeze(result);
}

function tempo(dto: PerformanceTempoEventRead): PerformanceTempoEncounter {
  const bpm = Rational.decode(dto.bpm);
  if (bpm.compare(ZERO) <= 0) throw new Error('Invalid performance tempo.');
  return Object.freeze({
    occurrenceOrdinal: safeInteger(dto.occurrence_ordinal),
    performancePosition: Rational.decode(dto.performance_position),
    bpm,
  });
}

export function decodePerformancePlan(
  dto: PerformancePlanRead
): BrowserPerformancePlan {
  if (typeof dto.musicxml !== 'string' || !dto.musicxml.trim())
    throw new Error('Missing admitted MusicXML.');
  const performanceEnd = Rational.decode(dto.performance_end);
  const initialTempoBpm = Rational.decode(dto.initial_tempo_bpm);
  if (performanceEnd.compare(ZERO) < 0 || initialTempoBpm.compare(ZERO) <= 0)
    throw new Error('Invalid performance plan state.');
  const occurrences = dto.occurrences.map(occurrence);
  let end = ZERO;
  for (const [index, visit] of occurrences.entries()) {
    if (visit.ordinal !== index || visit.performanceStart.compare(end) !== 0)
      throw new Error('Discontinuous performance axis.');
    end = visit.performanceEnd;
  }
  if (end.compare(performanceEnd) !== 0)
    throw new Error('Invalid performance end.');
  const tempoEvents = dto.tempo_events.map(tempo);
  let previousPosition = ZERO;
  let previousOrdinal = 0;
  for (const event of tempoEvents) {
    const owner = occurrences[event.occurrenceOrdinal];
    if (
      !owner ||
      event.occurrenceOrdinal < previousOrdinal ||
      event.performancePosition.compare(previousPosition) < 0 ||
      event.performancePosition.compare(owner.performanceStart) < 0 ||
      event.performancePosition.compare(owner.performanceEnd) > 0
    ) {
      throw new Error('Invalid tempo encounter identity or ordering.');
    }
    previousPosition = event.performancePosition;
    previousOrdinal = event.occurrenceOrdinal;
  }
  return Object.freeze({
    musicxml: dto.musicxml,
    performanceEnd,
    initialTempoBpm,
    occurrences: Object.freeze(occurrences),
    tempoEvents: Object.freeze(tempoEvents),
  });
}
