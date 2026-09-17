import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type {
  PracticePerformanceClockPayload,
  PracticePerformanceTimelinePayload,
} from './protocol';
import type { PracticeVerovioAdapter } from './verovio-adapter';

type PerformancePlayheadState = {
  activeNoteIds: string[];
  activePage: number | null;
  sync: PracticePerformanceClockPayload | null;
  timeline: PracticePerformanceTimelinePayload | null;
  selectedRangeNoteIds: string[];
  syncReceivedAtMs: number;
  displayedBeat: number | null;
};

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function findElementByVerovioId(container: HTMLElement, verovioId: string) {
  return (
    container.querySelector<HTMLElement>(`[data-id="${verovioId}"]`) ??
    container.querySelector<HTMLElement>(`#${escapeCssId(verovioId)}`)
  );
}

function extractPageNumber(node: HTMLElement | null) {
  const pageContainer = node?.closest<HTMLElement>('[data-practice-page]');
  const pageValue = pageContainer?.dataset.practicePage;
  if (!pageValue) {
    return null;
  }

  const parsed = Number.parseInt(pageValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export class PerformancePlayheadController {
  private state: PerformancePlayheadState = {
    activeNoteIds: [],
    activePage: null,
    sync: null,
    timeline: null,
    selectedRangeNoteIds: [],
    syncReceivedAtMs: 0,
    displayedBeat: null,
  };

  clear(container: HTMLElement) {
    this.clearDecorations(container);
    this.state = {
      activeNoteIds: [],
      activePage: null,
      sync: null,
      timeline: null,
      selectedRangeNoteIds: [],
      syncReceivedAtMs: 0,
      displayedBeat: null,
    };
  }

  receiveSync(sync: PracticePerformanceClockPayload, receivedAtMs = performance.now()) {
    this.state.sync = sync;
    this.state.syncReceivedAtMs = receivedAtMs;
  }

  receiveTimeline(timeline: PracticePerformanceTimelinePayload) {
    if (this.state.timeline === timeline) {
      return;
    }
    this.state.timeline = timeline;
    this.state.displayedBeat = null;
  }

  receiveSelectedRangeNoteIds(noteIds: readonly string[]) {
    const uniqueNoteIds = Array.from(new Set(noteIds.filter(Boolean)));
    if (uniqueNoteIds.join('\u001f') === this.state.selectedRangeNoteIds.join('\u001f')) {
      return;
    }
    this.state.selectedRangeNoteIds = uniqueNoteIds;
    this.state.displayedBeat = null;
  }

  apply(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    receivedAtMs = performance.now()
  ): void {
    const beat = this.projectVisualBeat(receivedAtMs);
    if (beat === null) {
      this.clearDecorations(container);
      return;
    }

    this.applyBeat(container, adapter, beat, { monotonic: true });
  }

  applyPerformanceTime(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    performanceTimeMs: number,
    timeline: PracticePerformanceTimelinePayload
  ): void {
    this.receiveTimeline(timeline);
    const beat = this.projectTimelineBeat(performanceTimeMs);
    if (beat === null) {
      this.clearDecorations(container);
      return;
    }
    this.applyBeat(container, adapter, beat, { monotonic: false });
  }

  refreshDecorations(container: HTMLElement) {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.add('practice-note-active');
    }
  }

  private clearDecorations(container: HTMLElement) {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove('practice-note-active');
    }
    this.state.activeNoteIds = [];
    this.state.activePage = null;
  }

  private applyBeat(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    beat: number,
    options: { monotonic: boolean }
  ) {
    const previousPage = this.state.activePage;
    this.clearDecorations(container);
    const displayedBeat =
      options.monotonic && this.state.displayedBeat !== null
        ? Math.max(this.state.displayedBeat, beat)
        : beat;

    const scope = this.currentScope();
    const entry = scope
      ? adapter.getCursorTimelineEntryForBeatRange(
          displayedBeat,
          scope.startBeat,
          scope.terminalBeat,
          this.state.selectedRangeNoteIds
        )
      : adapter.getTimelineEntryForBeat(displayedBeat);
    if (!entry) {
      return;
    }
    this.state.displayedBeat = displayedBeat;

    const noteElements: HTMLElement[] = [];
    for (const noteId of entry.noteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.add('practice-note-active');
      noteElements.push(node);
      this.state.activeNoteIds.push(noteId);
    }

    const anchorNode = noteElements[0] ?? null;
    const activePage =
      extractPageNumber(anchorNode) ??
      (entry.noteIds[0] ? adapter.getPageWithElement(entry.noteIds[0]) : previousPage);
    if (activePage !== null) {
      const activePageNode = container.querySelector<HTMLElement>(
        `[data-practice-page="${activePage}"]`
      );
      this.state.activePage = activePage;
      if (
        activePageNode &&
        previousPage !== activePage &&
        shouldFocusPage(container, activePageNode)
      ) {
        focusPageContainer(container, activePageNode);
      }
    }

    if (anchorNode) {
      keepElementInViewport(container, anchorNode);
    }
  }

  private projectVisualBeat(nowMs: number) {
    const sync = this.state.sync;
    if (!sync) {
      return null;
    }
    if (sync.state === 'READY' || sync.state === 'ENDED' || sync.scope_completed) {
      return null;
    }
    if (sync.state === 'COUNT_IN' || sync.state === 'PAUSED') {
      return clampBeat(sync.musical_beat, sync.scope_start_beat, sync.scope_terminal_beat);
    }

    const elapsedMs = Math.max(0, nowMs - this.state.syncReceivedAtMs);
    const performanceTimeMs = sync.performance_time_ms + elapsedMs * sync.speed_ratio;
    return this.projectRunningBeat(performanceTimeMs, sync);
  }

  private projectRunningBeat(performanceTimeMs: number, sync: PracticePerformanceClockPayload) {
    const timelineBeat = this.projectTimelineBeat(performanceTimeMs);
    const projectedBeat = clampBeat(
      timelineBeat ?? sync.musical_beat,
      sync.scope_start_beat,
      sync.scope_terminal_beat
    );
    return this.state.displayedBeat === null
      ? projectedBeat
      : Math.max(this.state.displayedBeat, projectedBeat);
  }

  private currentScope() {
    const sync = this.state.sync;
    const timeline = this.state.timeline;
    if (!sync && !timeline) {
      return null;
    }
    return {
      startBeat: timeline?.scope_start_beat ?? sync?.scope_start_beat ?? 0,
      terminalBeat: timeline?.scope_terminal_beat ?? sync?.scope_terminal_beat ?? 0,
    };
  }

  private projectTimelineBeat(performanceTimeMs: number) {
    const timeline = this.state.timeline;
    if (!timeline || timeline.segments.length === 0) {
      return null;
    }

    return projectPerformanceTimeToBeat(timeline, performanceTimeMs);
  }
}

function clampBeat(beat: number, startBeat: number, terminalBeat: number) {
  return Math.min(Math.max(beat, startBeat), terminalBeat);
}

export function projectPerformanceTimeToBeat(
  timeline: PracticePerformanceTimelinePayload,
  performanceTimeMs: number
) {
  if (timeline.segments.length === 0) {
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
