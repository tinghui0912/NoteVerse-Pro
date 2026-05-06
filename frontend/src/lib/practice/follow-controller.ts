import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type { PracticeAlignmentUpdateMessage } from '@/types/api';
import type { PracticeVerovioAdapter } from './verovio-adapter';

type FollowControllerState = {
  activeNoteIds: string[];
  activePage: number | null;
  lastResolvedNoteIds: string[];
  lastStablePage: number | null;
  lastUpdateMs: number;
};

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
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

function findElementByVerovioId(container: HTMLElement, verovioId: string) {
  return (
    container.querySelector<HTMLElement>(`[data-id="${verovioId}"]`) ??
    container.querySelector<HTMLElement>(`#${escapeCssId(verovioId)}`)
  );
}

export class PracticeFollowController {
  private readonly noteGraceWindowMs = 450;

  private state: FollowControllerState = {
    activeNoteIds: [],
    activePage: null,
    lastResolvedNoteIds: [],
    lastStablePage: null,
    lastUpdateMs: 0,
  };

  clear(container: HTMLElement) {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove('practice-note-active');
    }

    this.state = {
      activeNoteIds: [],
      activePage: null,
      lastResolvedNoteIds: [],
      lastStablePage: null,
      lastUpdateMs: 0,
    };
  }

  refreshDecorations(container: HTMLElement) {
    for (const noteId of this.state.activeNoteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.add('practice-note-active');
    }
  }

  apply(
    container: HTMLElement,
    adapter: PracticeVerovioAdapter,
    alignment: PracticeAlignmentUpdateMessage['payload']
  ): void {
    const now = performance.now();
    const previousPage = this.state.activePage;
    const previousResolvedNoteIds = this.state.lastResolvedNoteIds;
    const previousStablePage = this.state.lastStablePage;
    const previousUpdateMs = this.state.lastUpdateMs;
    this.clear(container);

    const eventNoteIds = adapter.getNoteIdsForEventIndex(alignment.event_index);
    const canReusePreviousNotes =
      eventNoteIds.length === 0 &&
      previousResolvedNoteIds.length > 0 &&
      now - previousUpdateMs <= this.noteGraceWindowMs;
    const noteIds =
      eventNoteIds.length > 0
        ? eventNoteIds
        : canReusePreviousNotes
          ? previousResolvedNoteIds
          : [];
    const noteElements: HTMLElement[] = [];

    for (const noteId of noteIds) {
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
      (noteIds[0] ? adapter.getPageWithElement(noteIds[0]) : previousStablePage);
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

    this.state.lastResolvedNoteIds = noteIds;
    this.state.lastStablePage = activePage;
    this.state.lastUpdateMs = now;
  }
}
