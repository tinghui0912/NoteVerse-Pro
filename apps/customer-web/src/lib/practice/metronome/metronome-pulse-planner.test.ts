import { describe, expect, it } from 'vitest';
import {
  PracticeTempoTimeline,
  type ResolvedPracticeTempoPlan,
} from '../kernel/tempo';
import {
  isDownbeat,
  MetronomePulsePlanner,
  pulseIndexInMeasure,
  pulseStepTicks,
} from './metronome-pulse-planner';

const source = {
  ticksPerQuarter: 6,
  meterSegments: [
    { startTick: 0, numerator: 3, denominator: 8 },
    { startTick: 18, numerator: 5, denominator: 16 },
  ],
};
const plan: ResolvedPracticeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [
    { startTick: 0, bpm: 120, source: 'MUSICXML' },
    { startTick: 12, bpm: 60, source: 'MUSICXML' },
  ],
};
// Six ticks cannot express a sixteenth pulse; the admitted grid must include that denominator.
const exact = {
  ...source,
  ticksPerQuarter: 12,
  meterSegments: source.meterSegments.map((m) => ({
    ...m,
    startTick: m.startTick * 2,
  })),
};
const tempo: ResolvedPracticeTempoPlan = {
  ...plan,
  segments: plan.segments.map((s) => ({ ...s, startTick: s.startTick * 2 })),
};
const timeline = new PracticeTempoTimeline(tempo, 96, 12);

describe('integer metronome grids', () => {
  it('uses exact 3/8 and 5/16 pulse coordinates', () => {
    expect(pulseStepTicks(exact.meterSegments[0], 12)).toBe(6);
    expect(pulseStepTicks(exact.meterSegments[1], 12)).toBe(3);
    expect(isDownbeat(exact.meterSegments[0], 18, 12)).toBe(true);
    expect(pulseIndexInMeasure(exact.meterSegments[0], 12, 12)).toBe(2);
    expect(() => pulseStepTicks(source.meterSegments[1], 6)).toThrow();
    expect(() => pulseIndexInMeasure(exact.meterSegments[0], 1, 12)).toThrow();
  });
  it('integrates tempo changes and switches meter on the exact segment tick', () => {
    const pulses = MetronomePulsePlanner.planContinuousPulses({
      timeline,
      artifact: exact,
      scopeStartTick: 0,
      countInPulses: 0,
      countInTicks: 0,
      windowStartMs: 0,
      windowEndMs: 3250,
    });
    expect(pulses.map((p) => p.scoreTick)).toEqual([
      0, 6, 12, 18, 24, 30, 36, 39, 42, 45, 48, 51,
    ]);
    expect(pulses.map((p) => p.timeMs)).toEqual([
      0, 250, 500, 750, 1000, 1500, 2000, 2250, 2500, 2750, 3000, 3250,
    ]);
  });
  it('count-in stays anchored to the selected target and uses denominator pulses', () => {
    const pulses = MetronomePulsePlanner.planContinuousPulses({
      timeline,
      artifact: exact,
      scopeStartTick: 18,
      countInPulses: 3,
      countInTicks: 18,
      windowStartMs: -750,
      windowEndMs: 0,
    });
    expect(pulses.map((p) => p.timeMs)).toEqual([-750, -500, -250, 0]);
    expect(pulses.map((p) => p.scoreTick)).toEqual([18, 18, 18, 18]);
    expect(pulses.slice(0, 3).map((p) => p.pulseIndexInMeasure)).toEqual([
      0, 1, 2,
    ]);
  });
  it('running resume preserves wall-time phase and chooses an integer future pulse', () => {
    const cursor = MetronomePulsePlanner.createContinuousCursor(
      { state: 'RUNNING', timelineTimeMs: 375 },
      exact,
      timeline,
      5000
    );
    expect(cursor).toMatchObject({
      phase: 'RUNNING',
      currentTick: 12,
      nextPulseTimeMs: 5125,
    });
    const result = MetronomePulsePlanner.planNextPulses(cursor, 5500, {
      artifact: exact,
      timeline,
      scopeEndTick: 18,
    });
    expect(result.pulses.map((p) => p.scoreTick)).toEqual([12, 18]);
    expect(result.pulses.map((p) => p.timeMs)).toEqual([5125, 5375]);
  });
  it('resumes count-in without moving the frozen target and then restores running phase', () => {
    const cursor = MetronomePulsePlanner.createContinuousCursor(
      {
        state: 'COUNT_IN',
        scopeStartTick: 6,
        timelineTimeMs: 375,
        countInTotalMs: 750,
        countInRemainingMs: 375,
        countInPulses: 3,
      },
      exact,
      timeline,
      1000
    );
    const result = MetronomePulsePlanner.planNextPulses(cursor, 1600, {
      artifact: exact,
      timeline,
      scopeEndTick: 18,
    });
    expect(result.pulses.map((p) => [p.scoreTick, p.timeMs])).toEqual([
      [6, 1125],
      [12, 1500],
    ]);
  });
  it('STEP keeps target tempo across later source tempo while following the meter grid', () => {
    const cursor = MetronomePulsePlanner.createStepCursor(21, exact, timeline);
    expect(cursor).toMatchObject({
      targetOnsetTick: 21,
      currentTick: 24,
      fixedBpm: 120,
      nextPulseTimeMs: 125,
    });
    const result = MetronomePulsePlanner.planNextPulses(cursor, 1125, {
      artifact: exact,
      timeline,
      scopeEndTick: 96,
    });
    expect(result.pulses.map((p) => p.scoreTick)).toEqual([
      24, 30, 36, 39, 42, 45, 48,
    ]);
    expect(result.pulses.every((p) => p.bpm === 120)).toBe(true);
  });
  it('successive scheduling windows neither consume nor duplicate pulses', () => {
    const cursor = MetronomePulsePlanner.createContinuousCursor(
      { state: 'RUNNING', timelineTimeMs: 0 },
      exact,
      timeline
    );
    const a = MetronomePulsePlanner.planNextPulses(cursor, 500, {
      artifact: exact,
      timeline,
      scopeEndTick: 24,
    });
    const b = MetronomePulsePlanner.planNextPulses(a.nextCursor, 1000, {
      artifact: exact,
      timeline,
      scopeEndTick: 24,
    });
    expect([...a.pulses, ...b.pulses].map((p) => p.scoreTick)).toEqual([
      0, 6, 12, 18, 24,
    ]);
  });
});
