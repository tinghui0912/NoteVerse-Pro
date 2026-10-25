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

type PerformanceNoteAnnotations = {
  supportedNoteIds: string[];
  wrongNoteIds: string[];
  missedNoteIds: string[];
};
const annotationClasses = ['practice-summary-note-supported', 'practice-summary-note-wrong', 'practice-summary-note-missed'] as const;

export class PerformanceAnnotationController {
  private supportedNoteIds = new Set<string>();
  private wrongNoteIds = new Set<string>();
  private missedNoteIds = new Set<string>();
  private currentContainer: HTMLElement | null = null;
  private renderRevision: number | string | null = null;

  clear(container: HTMLElement) {
    for (const id of new Set([...this.supportedNoteIds, ...this.wrongNoteIds, ...this.missedNoteIds])) {
      findElementByVerovioId(container, id)?.classList.remove(...annotationClasses);
    }
    this.supportedNoteIds.clear();
    this.wrongNoteIds.clear();
    this.missedNoteIds.clear();
    this.currentContainer = null;
    this.renderRevision = null;
  }

  apply(container: HTMLElement, annotations: PerformanceNoteAnnotations, options: { renderRevision?: number | string } = {}) {
    const wrong = new Set(annotations.wrongNoteIds.filter(Boolean));
    const supported = new Set(annotations.supportedNoteIds.filter(id => id && !wrong.has(id)));
    const missed = new Set(annotations.missedNoteIds.filter(id => id && !wrong.has(id) && !supported.has(id)));
    const previous = [this.supportedNoteIds, this.wrongNoteIds, this.missedNoteIds];
    const next = [supported, wrong, missed];
    const rehydrate = this.currentContainer !== container || this.renderRevision !== (options.renderRevision ?? null);
    if (rehydrate) {
      for (const id of new Set([...previous, ...next].flatMap(ids => [...ids]))) {
        findElementByVerovioId(container, id)?.classList.remove(...annotationClasses);
      }
    }
    for (const [index, className] of annotationClasses.entries()) {
      for (const id of previous[index]) {
        if (!next[index].has(id) && !rehydrate) findElementByVerovioId(container, id)?.classList.remove(className);
      }
      for (const id of next[index]) {
        if (rehydrate || !previous[index].has(id)) findElementByVerovioId(container, id)?.classList.add(className);
      }
    }
    this.supportedNoteIds = supported;
    this.wrongNoteIds = wrong;
    this.missedNoteIds = missed;
    this.currentContainer = container;
    this.renderRevision = options.renderRevision ?? null;
  }
}

function annotationsFromInterpretation(interpretation: ContinuousEvaluationSnapshot['interpretation']): PerformanceNoteAnnotations {
  const supportedNoteIds: string[] = [], wrongNoteIds: string[] = [], missedNoteIds: string[] = [];
  for (const group of interpretation.groups) {
    if (group.verdict === 'PENDING') continue;
    for (const strike of group.strikes) {
      if (strike.state === 'CORRECT' || strike.state === 'SUPPORTED') supportedNoteIds.push(...strike.renderNoteIds);
      else if (interpretation.inputSource === 'MIDI' && strike.state === 'WRONG') wrongNoteIds.push(...strike.renderNoteIds);
      else if (interpretation.inputSource === 'MIDI' && strike.state === 'MISSING') missedNoteIds.push(...strike.renderNoteIds);
    }
  }
  return { supportedNoteIds, wrongNoteIds, missedNoteIds };
}
export function noteAnnotationsFromContinuousEvaluation(evaluation: ContinuousEvaluationSnapshot) {
  return annotationsFromInterpretation(evaluation.interpretation);
}
export function noteAnnotationsFromCompletedEvaluation(evaluation: CompletedContinuousEvaluation): PerformanceNoteAnnotations {
  return evaluation.status === 'UNAVAILABLE' ? { supportedNoteIds: [], wrongNoteIds: [], missedNoteIds: [] }
    : annotationsFromInterpretation(evaluation.interpretation);
}
