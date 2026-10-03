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
  private annotatedNoteIds: string[] = [];

  clear(container: HTMLElement) {
    for (const noteId of this.annotatedNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    this.annotatedNoteIds = [];
  }

  apply(
    container: HTMLElement,
    annotations: {
      confirmedCorrectNoteIds: string[];
      confirmedErrorNoteIds: string[];
    }
  ) {
    this.clear(container);
    this.applyClass(
      container,
      annotations.confirmedCorrectNoteIds,
      'practice-summary-note-confirmed-correct'
    );
    this.applyClass(
      container,
      annotations.confirmedErrorNoteIds,
      'practice-summary-note-confirmed-error'
    );
  }

  private applyClass(container: HTMLElement, noteIds: string[], className: string) {
    const uniqueNoteIds = Array.from(new Set(noteIds.filter(Boolean)));
    for (const noteId of uniqueNoteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.remove(...this.annotationClasses);
      node.classList.add(className);
      this.annotatedNoteIds.push(noteId);
    }
  }
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
