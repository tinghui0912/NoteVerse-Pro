import type { PracticePerformanceTimelineRead } from '@/generated/practice-api';
import type { PerformancePlayheadController } from './performance-playhead-controller';
import type { PracticeVerovioAdapter } from './verovio-adapter';

function clampBeat(beat: number, startBeat: number, terminalBeat: number) {
  return Math.min(Math.max(beat, startBeat), terminalBeat);
}

export function projectPerformanceTimeToBeat(
  timeline: PracticePerformanceTimelineRead,
  performanceTimeMs: number
): number | null {
  if (!timeline.segments || timeline.segments.length === 0) {
    return null;
  }
  const boundedTime = Math.min(
    Math.max(performanceTimeMs, 0),
    timeline.segments.at(-1)?.end_performance_time_ms ?? 0
  );
  const segment =
    timeline.segments.find(
      (item) =>
        item.start_performance_time_ms <= boundedTime &&
        boundedTime < item.end_performance_time_ms
    ) ?? timeline.segments.at(-1);
  if (!segment) {
    return null;
  }
  const durationMs = segment.end_performance_time_ms - segment.start_performance_time_ms;
  if (durationMs <= 0) {
    return segment.end_beat;
  }
  const progress = (boundedTime - segment.start_performance_time_ms) / durationMs;
  return clampBeat(
    segment.start_beat + (segment.end_beat - segment.start_beat) * progress,
    timeline.scope_start_beat,
    timeline.scope_terminal_beat
  );
}

export function applySummaryPerformanceTime(
  playhead: PerformancePlayheadController,
  container: HTMLElement,
  adapter: PracticeVerovioAdapter,
  performanceTimeMs: number,
  timeline: PracticePerformanceTimelineRead
): void {
  const beat = projectPerformanceTimeToBeat(timeline, performanceTimeMs);
  if (beat === null) {
    playhead.clear(container);
    return;
  }
  playhead.apply(container, adapter, beat, {
    startBeat: timeline.scope_start_beat,
    terminalBeat: timeline.scope_terminal_beat,
  });
}
