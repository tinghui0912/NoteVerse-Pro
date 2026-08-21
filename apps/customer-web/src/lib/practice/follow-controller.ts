import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type { PracticeAlignmentUpdateMessage } from '@/lib/practice/protocol';
import type { PracticeVerovioAdapter, PracticeVisualTimelineEntry } from './verovio-adapter';

type FollowControllerState = {
  activeNoteIds: string[];
  activePage: number | null;
  lastResolvedNoteIds: string[];
  lastStablePage: number | null;
  lastUpdateMs: number;
  lastAcceptedBeat: number | null;
  lastAcceptedTimelineIndex: number | null;
  pendingTimelineIndex: number | null;
  pendingBeat: number | null;
  pendingCount: number;
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
  private readonly maxFollowingJumpEvents = 1;
  private readonly minSequentialPromptAdvanceMs = 220;
  private readonly commitFrames = 3;
  private readonly commitBeatTolerance = 0.35;

  private state: FollowControllerState = {
    activeNoteIds: [],
    activePage: null,
    lastResolvedNoteIds: [],
    lastStablePage: null,
    lastUpdateMs: 0,
    lastAcceptedBeat: null,
    lastAcceptedTimelineIndex: null,
    pendingTimelineIndex: null,
    pendingBeat: null,
    pendingCount: 0,
  };

  clear(container: HTMLElement) {
    this.clearDecorations(container);

    this.state = {
      activeNoteIds: [],
      activePage: null,
      lastResolvedNoteIds: [],
      lastStablePage: null,
      lastUpdateMs: 0,
      lastAcceptedBeat: null,
      lastAcceptedTimelineIndex: null,
      pendingTimelineIndex: null,
      pendingBeat: null,
      pendingCount: 0,
    };
  }

  private clearDecorations(container: HTMLElement) {
    for (const noteId of this.state.activeNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove('practice-note-active');
    }
    this.state.activeNoteIds = [];
    this.state.activePage = null;
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
    this.clearDecorations(container);

    const rawCandidate = this.resolveDisplayAnchor(adapter, alignment);
    const candidate =
      alignment.decision.action === 'relocalize'
        ? rawCandidate
        : this.clampToSequentialPrompt(rawCandidate, adapter, now);
    const acceptedCandidate = this.resolveCandidate(candidate, alignment);
    if (!acceptedCandidate) {
      this.debug('rejected', alignment, candidate);
      this.restorePreviousState(previousResolvedNoteIds, previousStablePage, previousUpdateMs);
      this.refreshDecorations(container);
      return;
    }

    this.debug('accepted', alignment, acceptedCandidate);
    this.state.lastAcceptedBeat = acceptedCandidate.beat;
    this.state.lastAcceptedTimelineIndex = acceptedCandidate.index;
    this.clearPendingCandidate();

    const eventNoteIds = acceptedCandidate.noteIds;
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

  private resolveCandidate(
    candidate: PracticeVisualTimelineEntry | null,
    alignment: PracticeAlignmentUpdateMessage['payload']
  ) {
    if (!candidate) {
      return null;
    }

    if (
      alignment.decision.action === 'hold' ||
      alignment.decision.action === 'wait'
    ) {
      this.clearPendingCandidate();
      return null;
    }

    if (alignment.decision.action === 'relocalize') {
      this.clearPendingCandidate();
      return candidate;
    }

    if (this.state.lastAcceptedBeat === null || this.state.lastAcceptedTimelineIndex === null) {
      if (!this.isPromptAlignment(alignment) && !this.hasStableCommit(candidate)) {
        return null;
      }
      return candidate;
    }

    if (candidate.index === this.state.lastAcceptedTimelineIndex) {
      this.clearPendingCandidate();
      return candidate;
    }

    if (!this.hasStableCommit(candidate)) {
      return null;
    }

    return candidate;
  }

  private hasStableCommit(candidate: PracticeVisualTimelineEntry) {
    const samePendingCandidate =
      this.state.pendingTimelineIndex === candidate.index &&
      this.state.pendingBeat !== null &&
      Math.abs(this.state.pendingBeat - candidate.beat) <= this.commitBeatTolerance;

    if (samePendingCandidate) {
      this.state.pendingCount += 1;
    } else {
      this.state.pendingTimelineIndex = candidate.index;
      this.state.pendingBeat = candidate.beat;
      this.state.pendingCount = 1;
    }

    return this.state.pendingCount >= this.commitFrames;
  }

  private resolveDisplayAnchor(
    adapter: PracticeVerovioAdapter,
    alignment: PracticeAlignmentUpdateMessage['payload']
  ) {
    if (
      alignment.decision.action === 'hold' ||
      alignment.decision.action === 'wait'
    ) {
      return null;
    }

    const displayAnchor = alignment.decision.display_anchor;
    if (displayAnchor) {
      return adapter.getTimelineEntryForDisplayAnchor(displayAnchor);
    }

    const anchorBeat = alignment.beat_position;
    return (
      adapter.getTimelineEntryForBeat(anchorBeat) ??
      adapter.getNextTimelineEntryAfterBeat(anchorBeat)
    );
  }

  private clearPendingCandidate() {
    this.state.pendingTimelineIndex = null;
    this.state.pendingBeat = null;
    this.state.pendingCount = 0;
  }

  private isPromptAlignment(alignment: PracticeAlignmentUpdateMessage['payload']) {
    return (
      alignment.gate_reason === 'first_note_prompt' ||
      alignment.gate_reason === 'start_confirmed' ||
      alignment.timestamp_ms === 0
    );
  }

  private clampToSequentialPrompt(
    candidate: PracticeVisualTimelineEntry | null,
    adapter: PracticeVerovioAdapter,
    now: number
  ) {
    if (!candidate) {
      return null;
    }

    const lastIndex = this.state.lastAcceptedTimelineIndex;
    if (lastIndex === null || candidate.index <= lastIndex + this.maxFollowingJumpEvents) {
      return candidate;
    }

    if (now - this.state.lastUpdateMs < this.minSequentialPromptAdvanceMs) {
      return null;
    }

    return adapter.getTimelineEntryByIndex(lastIndex + 1) ?? candidate;
  }

  private restorePreviousState(
    previousResolvedNoteIds: string[],
    previousStablePage: number | null,
    previousUpdateMs: number
  ) {
    this.state.lastResolvedNoteIds = previousResolvedNoteIds;
    this.state.lastStablePage = previousStablePage;
    this.state.lastUpdateMs = previousUpdateMs;
    this.state.activeNoteIds = [...previousResolvedNoteIds];
    this.state.activePage = previousStablePage;
  }

  private debug(
    decision: 'accepted' | 'rejected',
    alignment: PracticeAlignmentUpdateMessage['payload'],
    candidate: PracticeVisualTimelineEntry | null
  ) {
    void decision;
    void alignment;
    void candidate;
  }
}
