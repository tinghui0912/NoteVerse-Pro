import {
  mediaTimeToPerformanceTimeMs,
  type PerformanceReviewDraft,
} from './performance-review-draft';
import { PracticeTempoTimeline } from './local-core/practice-tempo';
import { toShareVideoSession, type ShareVideoSessionInput } from './share-video-session';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export type ResolveSplitScreenFrameInput = {
  session?: ShareVideoSessionInput;
  draft?: PerformanceReviewDraft;
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
  session: sessionInput,
  draft,
  adapter,
  pageNumberResolver,
  mediaTimeMs,
  actualMediaDurationMs,
  scoreEndBeat,
}: ResolveSplitScreenFrameInput): SplitScreenScoreFrame | null {
  const session = toShareVideoSession(sessionInput ?? draft!);
  const perfTimeMs = mediaTimeToPerformanceTimeMs(
    mediaTimeMs,
    session.recordingTimebase,
    actualMediaDurationMs
  );
  if (perfTimeMs === null) {
    return null;
  }

  const timeline = new PracticeTempoTimeline(session.tempoPlan, scoreEndBeat);
  const scopeStartMs = session.replayTiming?.scopeStartMs ?? 0;
  const musicalBeat = timeline.timeMsToBeat(scopeStartMs + perfTimeMs);
  const entry = adapter.getCursorTimelineEntryForBeatRange(
    musicalBeat,
    session.scope.startBeat,
    session.scope.terminalBeat
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
