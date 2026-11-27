import { describe, expect, it } from 'vitest';
import type { PerformancePlanRead } from '@/generated/api';
import {
  linearPlan,
  rational,
} from '../../../../tests/support/performance-plan';
import { decodePerformancePlan } from './plan';

describe('performance plan transport boundary', () => {
  it('decodes to immutable runtime objects without mutating transport', () => {
    const dto = linearPlan();
    const plan = decodePerformancePlan(dto);
    expect(plan.performanceEnd.numerator).toBe(4n);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.occurrences)).toBe(true);
    expect(Object.isFrozen(plan.occurrences[0])).toBe(true);
    expect(dto.performance_end.numerator).toBe(4);
  });

  it.each([
    (p: PerformancePlanRead) => {
      p.musicxml = '';
    },
    (p: PerformancePlanRead) => {
      p.initial_tempo_bpm = rational(0);
    },
    (p: PerformancePlanRead) => {
      p.performance_end = rational(5);
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].ordinal = 1;
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].measure_index = -1;
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].visit = 0;
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].written_start = rational(5);
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].performance_start = rational(1);
    },
    (p: PerformancePlanRead) => {
      p.occurrences[0].written_end = rational(3);
    },
    (p: PerformancePlanRead) => {
      p.tempo_events = [
        {
          occurrence_ordinal: 1,
          performance_position: rational(0),
          bpm: rational(100),
        },
      ];
    },
    (p: PerformancePlanRead) => {
      p.tempo_events = [
        {
          occurrence_ordinal: 0,
          performance_position: rational(5),
          bpm: rational(100),
        },
      ];
    },
    (p: PerformancePlanRead) => {
      p.tempo_events = [
        {
          occurrence_ordinal: 0,
          performance_position: rational(1),
          bpm: rational(0),
        },
      ];
    },
    (p: PerformancePlanRead) => {
      p.tempo_events = [2, 1].map((q) => ({
        occurrence_ordinal: 0,
        performance_position: rational(q),
        bpm: rational(100),
      }));
    },
  ])('fails closed on an invalid transport invariant', (mutate) => {
    const dto = linearPlan();
    mutate(dto);
    expect(() => decodePerformancePlan(dto)).toThrow();
  });
});
