import { mediaTimeToPerformanceTimeMs } from './completed-performance';
import { PracticeTempoTimeline } from './local-core/practice-tempo';
import { resolveScopeTiming } from './scope-timing';
import type { ShareVideoSession } from './share-video-session';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export type ResolveSplitScreenFrameInput = {
  session: ShareVideoSession;
  adapter: Pick<
    PracticeVerovioAdapter,
    'getCursorTimelineEntryForBeatRange' | 'getPageWithElement'
  >;
  pageNumberResolver?: (noteIds: readonly string[]) => number | null;
  mediaTimeMs: number;
  actualMediaDurationMs?: number | null;
  scoreEndBeat: number;
};

export type SplitScreenScoreFrame = {
  perfTimeMs: number;
  musicalBeat: number;
  pageNumber: number;
  noteIds: string[];
};

export function resolveSplitScreenScoreFrame({
  session,
  adapter,
  pageNumberResolver,
  mediaTimeMs,
  actualMediaDurationMs,
  scoreEndBeat,
}: ResolveSplitScreenFrameInput): SplitScreenScoreFrame | null {
  const perfTimeMs = mediaTimeToPerformanceTimeMs(
    mediaTimeMs,
    session.recordingTimebase,
    actualMediaDurationMs
  );
  if (perfTimeMs === null) {
    return null;
  }

  const timeline = new PracticeTempoTimeline(session.tempoPlan, scoreEndBeat);
  const scopeStartMs = resolveScopeTiming(session.scope, session.tempoPlan, scoreEndBeat).scopeStartMs;
  const musicalBeat = timeline.timeMsToBeat(scopeStartMs + perfTimeMs);
  const entry = adapter.getCursorTimelineEntryForBeatRange(
    musicalBeat,
    session.scope.startBeat,
    session.scope.terminalBeat,
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
    musicalBeat,
    pageNumber,
    noteIds: entry.noteIds,
  };
}
