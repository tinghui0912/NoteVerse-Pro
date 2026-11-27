import type { ContinuousMetronomeSyncPoint } from '@/lib/practice/metronome/metronome-pulse-planner';
import type { PerformanceClockSnapshot } from './domain/performance-clock';

export function continuousMetronomeSyncPoint(snapshot: PerformanceClockSnapshot): ContinuousMetronomeSyncPoint {
  if (snapshot.state === 'COUNT_IN') {
    return {
      state: 'COUNT_IN', scopeStartTick: snapshot.scoreTick,
      timelineTimeMs: snapshot.timelineTimeMs, countInTotalMs: snapshot.countInTotalMs, countInRemainingMs: snapshot.countInRemainingMs,
      countInPulses: snapshot.countInPulses,
    };
  }
  return { state: 'RUNNING', timelineTimeMs: snapshot.timelineTimeMs };
}
