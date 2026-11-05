import { mediaTimeToPerformanceTimeMs } from '@/lib/practice/recording/recording-timebase';
import { PracticeTempoTimeline } from '@/lib/practice/planning/tempo';
import { resolveScopeTiming } from '@/lib/practice/score-view/scope-timing';
import type { VideoExportSession } from './session';
import type { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

export type ResolveVideoExportPlaybackPositionInput = {
  session: VideoExportSession;
  adapter: Pick<
    PracticeVerovioAdapter,
    'getCursorTimelineEntryForTickRange' | 'getPageWithElement'
  >;
  pageNumberResolver?: (noteIds: readonly string[]) => number | null;
  mediaTimeMs: number;
  actualMediaDurationMs?: number | null;
  scoreEndTick: number; ticksPerQuarter: number;
};

export type VideoExportPlaybackPosition = {
  perfTimeMs: number;
  scoreTick: number;
  pageNumber: number;
  noteIds: string[];
};

export function resolveVideoExportPlaybackPosition({
  session,
  adapter,
  pageNumberResolver,
  mediaTimeMs,
  actualMediaDurationMs,
  scoreEndTick, ticksPerQuarter,
}: ResolveVideoExportPlaybackPositionInput): VideoExportPlaybackPosition | null {
  const perfTimeMs = mediaTimeToPerformanceTimeMs(
    mediaTimeMs,
    session.recordingTimebase,
    actualMediaDurationMs
  );
  if (perfTimeMs === null) {
    return null;
  }

  const timeline = new PracticeTempoTimeline(session.tempoPlan, scoreEndTick, ticksPerQuarter);
  const scopeStartMs = resolveScopeTiming(session.scope, session.tempoPlan, scoreEndTick, ticksPerQuarter).scopeStartMs;
  const scoreTick = timeline.timeMsToTick(scopeStartMs + perfTimeMs);
  const entry = adapter.getCursorTimelineEntryForTickRange(
    scoreTick,
    session.scope.startTick,
    session.scope.terminalTick,
    session.scope.kind === 'RANGE' ? session.scope.allowedNoteIds : undefined
  );
  if (!entry || entry.noteIds.length === 0) {
    return null;
  }

  let pageNumber = 1;
  if (pageNumberResolver) {
    pageNumber = pageNumberResolver(entry.noteIds) ?? 1;
  } else {
    try {
      pageNumber = adapter.getPageWithElement(entry.noteIds[0]) ?? 1;
    } catch {
      pageNumber = 1;
    }
  }

  return {
    perfTimeMs,
    scoreTick,
    pageNumber,
    noteIds: entry.noteIds,
  };
}
