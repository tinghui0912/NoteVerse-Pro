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
