import type { RecordedPerformance } from './recorded-performance';
import { recordingMediaTimeMsToPerformanceTimeMs } from './recording-timebase';
import { PracticeTempoTimeline } from '@/lib/practice/planning/tempo';

export function recordedPerformancePosition(
  performance: RecordedPerformance,
  mediaTimeMs: number | null,
  actualMediaDurationMs?: number | null,
): Readonly<{ performanceTimeMs: number; scoreTick: number }> | null {
  if (mediaTimeMs === null) return null;
  const performanceTimeMs = recordingMediaTimeMsToPerformanceTimeMs(
    mediaTimeMs,
    performance.recording.timebase,
    actualMediaDurationMs,
  );
  if (performanceTimeMs === null) return null;
  const {
    scope,
    tempoPlan,
    bundle: { artifact },
  } = performance.executed;
  const timeline = new PracticeTempoTimeline(
    tempoPlan,
    artifact.scoreEndTick,
    artifact.ticksPerQuarter,
  );
  // The recording axis begins at the executed scope's performance origin.
  const scopeStartMs = timeline.tickToTimeMs(scope.startTick);
  return {
    performanceTimeMs,
    scoreTick: timeline.timeMsToTick(scopeStartMs + performanceTimeMs),
  };
}
export function recordedPerformanceScoreTick(
  performance: RecordedPerformance,
  mediaTimeMs: number | null,
  actualMediaDurationMs?: number | null,
): number | null {
  return (
    recordedPerformancePosition(performance, mediaTimeMs, actualMediaDurationMs)
      ?.scoreTick ?? null
  );
}
