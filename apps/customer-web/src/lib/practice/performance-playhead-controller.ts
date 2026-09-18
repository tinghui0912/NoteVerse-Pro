import type { PracticePerformanceTimelineRead } from '@/generated/practice-api';
import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export type PerformanceScopeBeats = {
  startBeat: number;
  terminalBeat: number;
  selectedRangeNoteIds?: readonly string[];
};

type PerformancePlayheadState = {
  activeNoteIds: string[];
  activePage: number | null;
  displayedBeat: number | null;
  selectedRangeNoteIds: string[];
};

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function extractPageNumber(node: HTMLElement | null): number | null {
  const pageContainer = node?.closest<HTMLElement>('[data-practice-page]');
  const pageValue = pageContainer?.dataset.practicePage;
  if (!pageValue) {
    return null;
  }
  const parsed = Number.parseInt(pageValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function findElementByVerovioId(container: HTMLElement, verovioId: string): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>(`[data-id="${verovioId}"]`) ??
    container.querySelector<HTMLElement>(`#${escapeCssId(verovioId)}`)
  );
}

export class PerformancePlayheadController {
  private state: PerformancePlayheadState = {
    activeNoteIds: [],
    activePage: null,
    displayedBeat: null,
    selectedRangeNoteIds: [],
  };

  clear(container: HTMLElement): void {
    this.clearDecorations(container);
    this.state = {
      activeNoteIds: [],
      activePage: null,
      displayedBeat: null,
      selectedRangeNoteIds: [],
    };
  }

  receiveSelectedRangeNoteIds(noteIds: readonly string[]): void {
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
    musicalBeat: number | null,
    scope?: PerformanceScopeBeats
  ): void {
    if (musicalBeat === null) {
      this.clearDecorations(container);
      return;
    }

    const previousPage = this.state.activePage;
    this.clearDecorations(container);

    const rangeNoteIds = scope?.selectedRangeNoteIds ?? this.state.selectedRangeNoteIds;
    const entry = scope
      ? adapter.getCursorTimelineEntryForBeatRange(
          musicalBeat,
          scope.startBeat,
          scope.terminalBeat,
          rangeNoteIds
        )
      : adapter.getTimelineEntryForBeat(musicalBeat);

    if (!entry) {
      return;
    }
    this.state.displayedBeat = musicalBeat;

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
    let activePage: number | null = extractPageNumber(anchorNode);
    if (activePage === null && entry.noteIds[0]) {
      try {
        activePage = adapter.getPageWithElement(entry.noteIds[0]);
      } catch {
        activePage = previousPage;
      }
    } else if (activePage === null) {
      activePage = previousPage;
    }

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

  applyPerformanceTime(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    performanceTimeMs: number,
    timeline: PracticePerformanceTimelineRead
  ): void {
    const beat = projectPerformanceTimeToBeat(timeline, performanceTimeMs);
    if (beat === null) {
      this.clearDecorations(container);
      return;
    }
    this.apply(container, adapter, beat, {
      startBeat: timeline.scope_start_beat,
      terminalBeat: timeline.scope_terminal_beat,
    });
  }

  refreshDecorations(container: HTMLElement): void {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.add('practice-note-active');
    }
  }

  private clearDecorations(container: HTMLElement): void {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove('practice-note-active');
    }
    this.state.activeNoteIds = [];
    this.state.activePage = null;
  }
}

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
