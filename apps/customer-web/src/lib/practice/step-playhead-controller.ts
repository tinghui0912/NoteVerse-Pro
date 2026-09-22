import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import {
  applyPlayheadCursor,
  clearPlayheadCursor,
} from './playhead-cursor';
import type { ExpectedPracticeGroup } from './local-core/artifact';
import type { PracticeVerovioAdapter } from './verovio-adapter';

type StepPlayheadState = {
  activeNoteIds: string[];
  activePage: number | null;
  activeGroupId: string | null;
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

export class StepPlayheadController {
  private state: StepPlayheadState = {
    activeNoteIds: [],
    activePage: null,
    activeGroupId: null,
  };

  clear(container: HTMLElement): void {
    this.clearDecorations(container);
    this.state = {
      activeNoteIds: [],
      activePage: null,
      activeGroupId: null,
    };
  }

  refreshDecorations(container: HTMLElement): void {
    if (this.state.activeNoteIds.length > 0) {
      applyPlayheadCursor(container, this.state.activeNoteIds);
    }
  }

  apply(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    group: ExpectedPracticeGroup | null
  ): void {
    const previousPage = this.state.activePage;
    this.clearDecorations(container);

    if (!group) {
      this.state.activeGroupId = null;
      return;
    }

    this.state.activeGroupId = group.groupId;
    const noteIds = group.renderNoteIds ?? [];
    const { anchor } = applyPlayheadCursor(container, noteIds);
    this.state.activeNoteIds.push(...Array.from(new Set(noteIds.filter(Boolean))));

    const anchorNode = anchor;
    let activePage: number | null = extractPageNumber(anchorNode);
    if (activePage === null && noteIds[0]) {
      try {
        activePage = adapter.getPageWithElement(noteIds[0]);
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

  private clearDecorations(container: HTMLElement): void {
    clearPlayheadCursor(container);
    this.state.activeNoteIds = [];
    this.state.activePage = null;
  }
}
