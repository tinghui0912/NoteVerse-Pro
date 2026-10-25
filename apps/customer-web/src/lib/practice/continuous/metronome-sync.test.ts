import { describe, expect, it } from 'vitest';
import type { PerformanceClockSnapshot } from './domain/performance-clock';
import { continuousMetronomeSyncPoint } from './metronome-sync';

const snapshot: PerformanceClockSnapshot = {
  state: 'COUNT_IN', nowMs: 500, musicalBeat: 2, performanceTimeMs: 0,
  countInTotalMs: 2000, countInRemainingMs: 1500, countInBeats: 4, countInPulses: 4, countInPulse: 2,
  scopeCompleted: false, scopeStartBeat: 2, scopeTerminalBeat: 10, completionReason: null,
};

describe('Continuous application metronome projection', () => {
  it('projects count-in timing without session or evaluation metadata', () => {
    expect(continuousMetronomeSyncPoint(snapshot)).toEqual({
      state: 'COUNT_IN', scopeStartBeat: 2, countInTotalMs: 2000, countInRemainingMs: 1500, countInPulses: 4,
    });
  });

  it('retains the running-beat planning coordinate outside count-in, including pause and terminal states', () => {
    for (const state of ['READY', 'RUNNING', 'PAUSED', 'ENDED'] as const) {
      expect(continuousMetronomeSyncPoint({ ...snapshot, state, musicalBeat: 3.25 }))
        .toEqual({ state: 'RUNNING', musicalBeat: 3.25 });
    }
  });
});
