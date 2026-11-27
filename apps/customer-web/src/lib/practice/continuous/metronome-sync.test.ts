import { describe, expect, it } from 'vitest';
import type { PerformanceClockSnapshot } from './domain/performance-clock';
import { continuousMetronomeSyncPoint } from './metronome-sync';

const snapshot: PerformanceClockSnapshot = {
  state: 'COUNT_IN', countInKind: 'INITIAL', nowMs: 500, scoreTick: 2, timelineTimeMs: 0, performanceTimeMs: 0,
  countInTotalMs: 2000, countInRemainingMs: 1500, countInTicks: 4, countInPulses: 4, countInPulse: 2,
  scopeCompleted: false, scopeStartTick: 2, scopeTerminalTick: 10, completionReason: null,
};

describe('Continuous application metronome projection', () => {
  it('projects count-in timing without session or evaluation metadata', () => {
    expect(continuousMetronomeSyncPoint(snapshot)).toEqual({
      state: 'COUNT_IN', scopeStartTick: 2, timelineTimeMs: 0, countInTotalMs: 2000, countInRemainingMs: 1500, countInPulses: 4,
    });
  });

  it('retains the running-tick planning coordinate outside count-in, including pause and terminal states', () => {
    for (const state of ['READY', 'RUNNING', 'PAUSED', 'ENDED'] as const) {
      expect(continuousMetronomeSyncPoint({ ...snapshot, state, scoreTick: 3, timelineTimeMs: 1625 }))
        .toEqual({ state: 'RUNNING', timelineTimeMs: 1625 });
    }
  });
});
