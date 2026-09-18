import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type { ExpectedPracticeGroup } from './local-core/artifact';
import type { PracticeVerovioAdapter } from './verovio-adapter';

type StepPlayheadState = {
  activeNoteIds: string[];
  activePage: number | null;
  activeGroupId: string | null;
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

function applyActiveNoteDecoration(node: HTMLElement) {
  node.classList.add('practice-note-active');
  node.closest<HTMLElement>('[data-class="chord"], .chord')?.classList.add('practice-note-active');
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
    for (const noteId of this.state.activeNoteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (node) {
        applyActiveNoteDecoration(node);
      }
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
    const noteElements: HTMLElement[] = [];

    for (const noteId of noteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      applyActiveNoteDecoration(node);
      noteElements.push(node);
      this.state.activeNoteIds.push(noteId);
    }

    const anchorNode = noteElements[0] ?? null;
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
    container
      .querySelectorAll('.practice-note-active')
      .forEach((node) => node.classList.remove('practice-note-active'));
    this.state.activeNoteIds = [];
    this.state.activePage = null;
  }
}
