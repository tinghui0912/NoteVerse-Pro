import {
  focusPageContainer,
  keepElementInViewport,
  shouldFocusPage,
} from './practice-scroll';
import type { PracticeAlignmentUpdateMessage } from '@/types/api';
import type { PracticeVerovioAdapter, PracticeVisualTimelineEntry } from './verovio-adapter';

type FollowControllerState = {
  activeNoteIds: string[];
  activePage: number | null;
  lastResolvedNoteIds: string[];
  lastStablePage: number | null;
  lastUpdateMs: number;
  lastAcceptedBeat: number | null;
  lastAcceptedTimelineIndex: number | null;
  mode: 'following' | 'desynced' | 'seeking';
  lowConfidenceSinceMs: number | null;
  recoveryStreak: number;
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
  private readonly lowConfidenceThreshold = 0.55;
  private readonly recoveryConfidenceThreshold = 0.75;
  private readonly desyncWindowMs = 1200;
  private readonly recoveryFrames = 3;
  private readonly backwardBeatTolerance = 0.25;
  private readonly maxFollowingJumpBeats = 4;
  private readonly debugEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PRACTICE_DEBUG === 'true';

  private state: FollowControllerState = {
    activeNoteIds: [],
    activePage: null,
    lastResolvedNoteIds: [],
    lastStablePage: null,
    lastUpdateMs: 0,
    lastAcceptedBeat: null,
    lastAcceptedTimelineIndex: null,
    mode: 'seeking',
    lowConfidenceSinceMs: null,
    recoveryStreak: 0,
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
      mode: 'seeking',
      lowConfidenceSinceMs: null,
      recoveryStreak: 0,
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

    const candidate = adapter.getTimelineEntryForBeat(alignment.beat_position);
    const acceptedCandidate = this.resolveCandidate(candidate, alignment, now);
    if (!acceptedCandidate) {
      this.debug('rejected', alignment, candidate);
      this.restorePreviousState(previousResolvedNoteIds, previousStablePage, previousUpdateMs);
      this.refreshDecorations(container);
      return;
    }

    this.debug('accepted', alignment, acceptedCandidate);
    this.state.lastAcceptedBeat = acceptedCandidate.beat;
    this.state.lastAcceptedTimelineIndex = acceptedCandidate.index;

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
    alignment: PracticeAlignmentUpdateMessage['payload'],
    now: number
  ) {
    if (!candidate) {
      return null;
    }

    if (alignment.confidence < this.lowConfidenceThreshold) {
      if (this.state.lowConfidenceSinceMs === null) {
        this.state.lowConfidenceSinceMs = now;
      }
      this.state.recoveryStreak = 0;
      if (now - this.state.lowConfidenceSinceMs >= this.desyncWindowMs) {
        this.state.mode = 'desynced';
      }
      return null;
    }

    this.state.lowConfidenceSinceMs = null;

    if (this.state.mode === 'desynced') {
      if (alignment.confidence < this.recoveryConfidenceThreshold) {
        this.state.recoveryStreak = 0;
        return null;
      }
      this.state.recoveryStreak += 1;
      if (this.state.recoveryStreak < this.recoveryFrames) {
        return null;
      }
      this.state.mode = 'seeking';
    }

    if (this.state.mode === 'seeking') {
      this.state.mode = 'following';
      this.state.recoveryStreak = 0;
      return candidate;
    }

    const lastBeat = this.state.lastAcceptedBeat;
    const lastIndex = this.state.lastAcceptedTimelineIndex;
    if (lastBeat === null || lastIndex === null) {
      return candidate;
    }

    const isBackward =
      candidate.index < lastIndex && candidate.beat < lastBeat - this.backwardBeatTolerance;
    if (isBackward) {
      this.state.mode = 'desynced';
      this.state.recoveryStreak = 0;
      return null;
    }

    const isLargeJump = candidate.beat > lastBeat + this.maxFollowingJumpBeats;
    if (isLargeJump && alignment.confidence < this.recoveryConfidenceThreshold) {
      this.state.mode = 'desynced';
      this.state.recoveryStreak = 0;
      return null;
    }

    return candidate;
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
    if (!this.debugEnabled) {
      return;
    }

    console.debug('[practice_follow]', {
      decision,
      mode: this.state.mode,
      beat: alignment.beat_position,
      confidence: alignment.confidence,
      candidate,
    });
  }
}
