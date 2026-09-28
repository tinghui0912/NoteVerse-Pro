import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import {
  applyPlayheadCursor,
  clearPlayheadCursor,
} from './playhead-cursor';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export type CursorScope =
  | {
      kind: 'FULL';
      startBeat: number;
      terminalBeat: number;
    }
  | {
      kind: 'RANGE';
      startBeat: number;
      terminalBeat: number;
      allowedNoteIds: readonly string[];
    };

type PerformancePlayheadState = {
  activeNoteIds: string[];
  activePage: number | null;
  displayedBeat: number | null;
};

function extractPageNumber(node: Element | null): number | null {
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
    displayedBeat: null,
  };

  clear(container: HTMLElement): void {
    this.clearDecorations(container);
    this.state = {
      activeNoteIds: [],
      activePage: null,
      displayedBeat: null,
    };
  }

  apply(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    musicalBeat: number | null,
    scope: CursorScope
  ): void {
    if (musicalBeat === null) {
      this.clearDecorations(container);
      return;
    }
    if (scope.kind === 'RANGE' && scope.allowedNoteIds.length === 0) {
      this.clearDecorations(container);
      return;
    }

    const previousPage = this.state.activePage;
    this.clearDecorations(container);

    const entry = adapter.getCursorTimelineEntryForBeatRange(
      musicalBeat,
      scope.startBeat,
      scope.terminalBeat,
      scope.kind === 'RANGE' ? scope.allowedNoteIds : undefined
    );

    if (!entry) {
      return;
    }
    this.state.displayedBeat = musicalBeat;

    const noteIds = Array.from(new Set(entry.noteIds.filter(Boolean)));
    const { anchor } = applyPlayheadCursor(container, noteIds);
    this.state.activeNoteIds = noteIds;

    const anchorNode = anchor;
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
    if (this.state.activeNoteIds.length > 0) {
      applyPlayheadCursor(container, this.state.activeNoteIds);
    }
  }

  private clearDecorations(container: HTMLElement): void {
    clearPlayheadCursor(container);
    this.state.activeNoteIds = [];
    this.state.activePage = null;
  }
}
