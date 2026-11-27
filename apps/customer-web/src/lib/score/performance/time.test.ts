import { describe, expect, it } from 'vitest';
import type { PerformancePlanRead } from '@/generated/api';
import {
  linearPlan,
  rational,
} from '../../../../tests/support/performance-plan';
import fixtures from '../../../../tests/fixtures/performance/canonical-plans.json';
import { decodePerformancePlan } from './plan';
import { Rational } from './rational';
import { createPerformanceTimeMapper } from './time';

describe('canonical performance time', () => {
  it('uses initial state without inventing a tempo encounter', () => {
    const plan = decodePerformancePlan(linearPlan());
    expect(plan.tempoEvents).toEqual([]);
    const time = createPerformanceTimeMapper(plan);
    expect(time.effectiveOriginTempoBpm).toBe(80);
    expect(time.performanceEndSeconds).toBe(3);
  });

  it('uses the last real origin encounter as reference tempo', () => {
    const dto = linearPlan(4, 100);
    dto.tempo_events.push({
      occurrence_ordinal: 0,
      performance_position: rational(0),
      bpm: rational(120),
    });
    const time = createPerformanceTimeMapper(decodePerformancePlan(dto));
    expect(time.effectiveOriginTempoBpm).toBe(120);
    expect(time.performanceEndSeconds).toBe(2);
  });

  it('integrates each exact tempo interval', () => {
    const dto = linearPlan(8);
    dto.tempo_events = [
      [2, 120],
      [5, 60],
    ].map(([q, bpm]) => ({
      occurrence_ordinal: 0,
      performance_position: rational(q),
      bpm: rational(bpm),
    }));
    const time = createPerformanceTimeMapper(decodePerformancePlan(dto));
    expect(time.performanceQuarterToExactSeconds(new Rational(5n))).toEqual(
      new Rational(3n)
    );
    expect(time.performanceEndSeconds).toBe(6);
    expect(() => time.performanceQuarterToSeconds(new Rational(9n))).toThrow();
  });

  it('preserves same-quarter source and destination encounter order', () => {
    const dto: PerformancePlanRead = structuredClone(
      fixtures.find((f) => f.name === 'repeat')!.plan
    );
    dto.tempo_events = [
      {
        occurrence_ordinal: 1,
        performance_position: rational(8),
        bpm: rational(100),
      },
      {
        occurrence_ordinal: 2,
        performance_position: rational(8),
        bpm: rational(80),
      },
    ];
    const plan = decodePerformancePlan(dto);
    expect(plan.tempoEvents.map((e) => e.bpm.toNumber())).toEqual([100, 80]);
    expect(createPerformanceTimeMapper(plan).performanceEndSeconds).toBe(12);
    dto.tempo_events.pop();
    expect(
      createPerformanceTimeMapper(decodePerformancePlan(dto))
        .performanceEndSeconds
    ).toBe(10.8);
  });

  it('replays repeated explicit facts in encounter order', () => {
    const dto: PerformancePlanRead = structuredClone(
      fixtures.find((f) => f.name === 'repeat')!.plan
    );
    dto.tempo_events = [
      [0, 0, 80],
      [1, 6, 100],
      [2, 8, 80],
      [3, 14, 100],
    ].map(([ordinal, q, bpm]) => ({
      occurrence_ordinal: ordinal,
      performance_position: rational(q),
      bpm: rational(bpm),
    }));
    expect(
      createPerformanceTimeMapper(decodePerformancePlan(dto))
        .performanceEndSeconds
    ).toBe(11.4);
  });

  it('keeps fractional tempo boundaries exact until seconds conversion', () => {
    const dto = linearPlan();
    dto.performance_end =
      dto.occurrences[0].written_end =
      dto.occurrences[0].performance_end =
        rational(4, 3);
    dto.tempo_events = [
      {
        occurrence_ordinal: 0,
        performance_position: rational(1, 3),
        bpm: rational(120),
      },
    ];
    const time = createPerformanceTimeMapper(decodePerformancePlan(dto));
    expect(time.performanceQuarterToExactSeconds(new Rational(1n, 3n))).toEqual(
      new Rational(1n, 4n)
    );
    expect(time.performanceEndSeconds).toBe(0.75);
  });
});
