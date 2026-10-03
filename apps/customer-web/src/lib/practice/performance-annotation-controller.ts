import type { PerformanceExpectedEventOutcome } from './local-core/evidence';

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

export class PerformanceAnnotationController {
  private readonly annotationClasses = [
    'practice-summary-note-confirmed-correct',
    'practice-summary-note-confirmed-error',
  ];
  private confirmedCorrectNoteIds = new Set<string>();
  private confirmedErrorNoteIds = new Set<string>();
  private currentContainer: HTMLElement | null = null;
  private renderRevision: number | string | null = null;

  clear(container: HTMLElement) {
    const annotatedNoteIds = new Set([
      ...this.confirmedCorrectNoteIds,
      ...this.confirmedErrorNoteIds,
    ]);
    for (const noteId of annotatedNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    this.confirmedCorrectNoteIds = new Set();
    this.confirmedErrorNoteIds = new Set();
    this.currentContainer = null;
    this.renderRevision = null;
  }

  apply(
    container: HTMLElement,
    annotations: {
      confirmedCorrectNoteIds: string[];
      confirmedErrorNoteIds: string[];
    },
    options: {
      renderRevision?: number | string;
    } = {}
  ) {
    const nextErrorSet = uniqueNoteIds(annotations.confirmedErrorNoteIds);
    const nextCorrectSet = uniqueNoteIds(annotations.confirmedCorrectNoteIds);
    for (const noteId of nextErrorSet) {
      nextCorrectSet.delete(noteId);
    }
    const shouldRehydrate =
      this.currentContainer !== container ||
      this.renderRevision !== (options.renderRevision ?? null);

    if (shouldRehydrate) {
      this.rehydrate(container, nextCorrectSet, nextErrorSet);
    } else {
      this.syncClassDiff(
        container,
        this.confirmedCorrectNoteIds,
        nextCorrectSet,
        'practice-summary-note-confirmed-correct'
      );
      this.syncClassDiff(
        container,
        this.confirmedErrorNoteIds,
        nextErrorSet,
        'practice-summary-note-confirmed-error'
      );
    }
    this.confirmedCorrectNoteIds = nextCorrectSet;
    this.confirmedErrorNoteIds = nextErrorSet;
    this.currentContainer = container;
    this.renderRevision = options.renderRevision ?? null;
  }

  private rehydrate(
    container: HTMLElement,
    nextCorrectIds: ReadonlySet<string>,
    nextErrorIds: ReadonlySet<string>
  ) {
    const noteIds = new Set([
      ...this.confirmedCorrectNoteIds,
      ...this.confirmedErrorNoteIds,
      ...nextCorrectIds,
      ...nextErrorIds,
    ]);
    for (const noteId of noteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    for (const noteId of nextCorrectIds) {
      findElementByVerovioId(container, noteId)?.classList.add(
        'practice-summary-note-confirmed-correct'
      );
    }
    for (const noteId of nextErrorIds) {
      findElementByVerovioId(container, noteId)?.classList.add(
        'practice-summary-note-confirmed-error'
      );
    }
  }

  private syncClassDiff(
    container: HTMLElement,
    previousIds: ReadonlySet<string>,
    nextIds: ReadonlySet<string>,
    className: string
  ) {
    for (const noteId of previousIds) {
      if (nextIds.has(noteId)) {
        continue;
      }
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.remove(className);
    }
    for (const noteId of nextIds) {
      if (previousIds.has(noteId)) {
        continue;
      }
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.remove(
        className === 'practice-summary-note-confirmed-correct'
          ? 'practice-summary-note-confirmed-error'
          : 'practice-summary-note-confirmed-correct'
      );
      node.classList.add(className);
    }
  }
}

function uniqueNoteIds(noteIds: readonly string[]) {
  return new Set(noteIds.filter(Boolean));
}

export function noteAnnotationsFromPerformanceOutcomes(
  outcomes: readonly PerformanceExpectedEventOutcome[]
): {
  confirmedCorrectNoteIds: string[];
  confirmedErrorNoteIds: string[];
} {
  const confirmedCorrectNoteIds: string[] = [];
  const confirmedErrorNoteIds: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.expectedStrikeOutcomes.length > 0) {
      for (const strike of outcome.expectedStrikeOutcomes) {
        if (strike.result === 'MATCHED') {
          confirmedCorrectNoteIds.push(...strike.renderNoteIds);
        } else if (strike.result === 'MISSING') {
          confirmedErrorNoteIds.push(...strike.renderNoteIds);
        }
      }
      continue;
    }

    if (outcome.result === 'MATCH') {
      confirmedCorrectNoteIds.push(...outcome.renderNoteIds);
    } else if (outcome.result === 'MISMATCH') {
      confirmedErrorNoteIds.push(...outcome.renderNoteIds);
    }
  }
  return { confirmedCorrectNoteIds, confirmedErrorNoteIds };
}
