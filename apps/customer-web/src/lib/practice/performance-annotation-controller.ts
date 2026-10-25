import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousEvaluationSnapshot } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';

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
    'practice-summary-note-supported',
    'practice-summary-note-error',
  ];
  private supportedNoteIds = new Set<string>();
  private errorNoteIds = new Set<string>();
  private currentContainer: HTMLElement | null = null;
  private renderRevision: number | string | null = null;

  clear(container: HTMLElement) {
    const annotatedNoteIds = new Set([
      ...this.supportedNoteIds,
      ...this.errorNoteIds,
    ]);
    for (const noteId of annotatedNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    this.supportedNoteIds = new Set();
    this.errorNoteIds = new Set();
    this.currentContainer = null;
    this.renderRevision = null;
  }

  apply(
    container: HTMLElement,
    annotations: {
      supportedNoteIds: string[];
      errorNoteIds: string[];
    },
    options: {
      renderRevision?: number | string;
    } = {}
  ) {
    const nextErrorSet = uniqueNoteIds(annotations.errorNoteIds);
    const nextSupportedSet = uniqueNoteIds(annotations.supportedNoteIds);
    for (const noteId of nextErrorSet) {
      nextSupportedSet.delete(noteId);
    }
    const shouldRehydrate =
      this.currentContainer !== container ||
      this.renderRevision !== (options.renderRevision ?? null);

    if (shouldRehydrate) {
      this.rehydrate(container, nextSupportedSet, nextErrorSet);
    } else {
      this.syncClassDiff(
        container,
        this.supportedNoteIds,
        nextSupportedSet,
        'practice-summary-note-supported'
      );
      this.syncClassDiff(
        container,
        this.errorNoteIds,
        nextErrorSet,
        'practice-summary-note-error'
      );
    }
    this.supportedNoteIds = nextSupportedSet;
    this.errorNoteIds = nextErrorSet;
    this.currentContainer = container;
    this.renderRevision = options.renderRevision ?? null;
  }

  private rehydrate(
    container: HTMLElement,
    nextCorrectIds: ReadonlySet<string>,
    nextErrorIds: ReadonlySet<string>
  ) {
    const noteIds = new Set([
      ...this.supportedNoteIds,
      ...this.errorNoteIds,
      ...nextCorrectIds,
      ...nextErrorIds,
    ]);
    for (const noteId of noteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    for (const noteId of nextCorrectIds) {
      findElementByVerovioId(container, noteId)?.classList.add(
        'practice-summary-note-supported'
      );
    }
    for (const noteId of nextErrorIds) {
      findElementByVerovioId(container, noteId)?.classList.add(
        'practice-summary-note-error'
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
        className === 'practice-summary-note-supported'
          ? 'practice-summary-note-error'
          : 'practice-summary-note-supported'
      );
      node.classList.add(className);
    }
  }
}

function uniqueNoteIds(noteIds: readonly string[]) {
  return new Set(noteIds.filter(Boolean));
}

function annotationsFromInterpretation(interpretation: ContinuousEvaluationSnapshot['interpretation']): { supportedNoteIds: string[]; errorNoteIds: string[] } {
  const supportedNoteIds: string[] = [], errorNoteIds: string[] = [];
  for (const group of interpretation.groups) {
    if (group.verdict === 'PENDING') continue;
    for (const strike of group.strikes) {
      if (strike.state === 'CORRECT' || strike.state === 'SUPPORTED') supportedNoteIds.push(...strike.renderNoteIds);
      else if (interpretation.inputSource === 'MIDI' && strike.state === 'MISSING') errorNoteIds.push(...strike.renderNoteIds);
    }
  }
  return { supportedNoteIds, errorNoteIds };
}
export function noteAnnotationsFromContinuousEvaluation(evaluation: ContinuousEvaluationSnapshot) {
  return annotationsFromInterpretation(evaluation.interpretation);
}
export function noteAnnotationsFromCompletedEvaluation(evaluation: CompletedContinuousEvaluation) {
  return evaluation.status === 'UNAVAILABLE' ? { supportedNoteIds: [], errorNoteIds: [] }
    : annotationsFromInterpretation(evaluation.interpretation);
}
