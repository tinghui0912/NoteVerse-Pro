import type { PerformancePlanRead } from '@/generated/api';

export const rational = (numerator: number, denominator = 1) => ({
  numerator,
  denominator,
});

export function linearPlan(end = 4, originBpm?: number): PerformancePlanRead {
  return {
    musicxml: '<score-partwise><part-list/><part/></score-partwise>',
    initial_tempo_bpm: rational(80),
    performance_end: rational(end),
    occurrences: [
      {
        ordinal: 0,
        measure_index: 0,
        visit: 1,
        written_start: rational(0),
        written_end: rational(end),
        performance_start: rational(0),
        performance_end: rational(end),
      },
    ],
    tempo_events:
      originBpm === undefined
        ? []
        : [
            {
              occurrence_ordinal: 0,
              performance_position: rational(0),
              bpm: rational(originBpm),
            },
          ],
  };
}
