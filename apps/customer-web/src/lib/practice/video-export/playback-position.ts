import { recordedPerformancePosition } from '@/lib/practice/recording/recorded-performance-timeline';
import { cursorScopeFromExecutedPerformance } from '@/lib/practice/score-view/cursor-scope';
import type { RecordedPerformance } from '@/lib/practice/recording/recorded-performance';
import type { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

export type ResolveVideoExportPlaybackPositionInput = {
  recordedPerformance: RecordedPerformance;
  adapter: Pick<
    PracticeVerovioAdapter,
    'getCursorTimelineEntryForTickRange' | 'getPageWithElement'
  >;
  pageNumberResolver?: (noteIds: readonly string[]) => number | null;
  mediaTimeMs: number;
  actualMediaDurationMs?: number | null;
};

export type VideoExportPlaybackPosition = {
  perfTimeMs: number;
  scoreTick: number;
  pageNumber: number;
  noteIds: string[];
};

export function resolveVideoExportPlaybackPosition({
  recordedPerformance,
  adapter,
  pageNumberResolver,
  mediaTimeMs,
  actualMediaDurationMs,
}: ResolveVideoExportPlaybackPositionInput): VideoExportPlaybackPosition | null {
  const position = recordedPerformancePosition(
    recordedPerformance,
    mediaTimeMs,
    actualMediaDurationMs,
  );
  if (!position) return null;
  const perfTimeMs = position.performanceTimeMs,
    scoreTick = position.scoreTick;
  const scope = cursorScopeFromExecutedPerformance(
    recordedPerformance.executed,
  );
  const entry = adapter.getCursorTimelineEntryForTickRange(
    scoreTick,
    scope.startTick,
    scope.terminalTick,
    scope.kind === 'RANGE' ? scope.allowedNoteIds : undefined,
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
