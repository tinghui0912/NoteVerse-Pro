import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import type { PlayablePerformanceReplay } from '@/lib/practice/recording/performance-replay';
import { mediaTimeToPerformanceTimeMs } from '@/lib/practice/recording/recording-timebase';
import { PracticeTempoTimeline, type ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import { resolveScopeTiming } from '@/lib/practice/score-view/scope-timing';

export function reviewReplay(recording: PerformanceRecording | null): PlayablePerformanceReplay | null {
  if (recording?.status !== 'READY') return null;
  return { kind: recording.kind === 'VIDEO' ? 'VIDEO_RECORDING' : 'AUDIO_RECORDING', blob: recording.blob,
    contentType: recording.mimeType, byteSize: recording.blob.size, durationMs: recording.durationMs };
}

export function reviewReplayMusicalBeat({ recording, mediaTimeMs, actualMediaDurationMs, scope, tempoPlan, scoreEndBeat }: {
  recording: PerformanceRecording | null; mediaTimeMs: number | null; actualMediaDurationMs?: number | null;
  scope: ResolvedPracticeScope; tempoPlan: ResolvedPracticeTempoPlan; scoreEndBeat: number;
}): number | null {
  if (mediaTimeMs === null || recording?.status !== 'READY') return null;
  const performanceTimeMs = mediaTimeToPerformanceTimeMs(mediaTimeMs, recording.timebase, actualMediaDurationMs);
  if (performanceTimeMs === null) return null;
  const timeline = new PracticeTempoTimeline(tempoPlan, scoreEndBeat);
  const scopeStartMs = resolveScopeTiming(scope, tempoPlan, scoreEndBeat).scopeStartMs;
  return timeline.timeMsToBeat(scopeStartMs + performanceTimeMs);
}
