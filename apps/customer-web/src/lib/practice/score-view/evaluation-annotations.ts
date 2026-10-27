import { findScoreElementByRenderId } from './dom';
import { REPORT_NOTE_CLASSES } from './decorations';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousLiveFeedback } from '@/lib/practice/continuous/domain/evaluation/live-feedback';

type EvaluationNoteAnnotations = {
  supportedNoteIds: string[];
  unsupportedNoteIds: string[];
};
const annotationClasses = REPORT_NOTE_CLASSES;

export class EvaluationAnnotationController {
  private supportedNoteIds = new Set<string>();
  private unsupportedNoteIds = new Set<string>();
  private currentContainer: HTMLElement | null = null;
  private renderRevision: number | string | null = null;

  clear(container: HTMLElement) {
    for (const id of new Set([...this.supportedNoteIds, ...this.unsupportedNoteIds])) {
      findScoreElementByRenderId(container, id)?.classList.remove(...annotationClasses);
    }
    this.supportedNoteIds.clear();
    this.unsupportedNoteIds.clear();
    this.currentContainer = null;
    this.renderRevision = null;
  }

  apply(container: HTMLElement, annotations: EvaluationNoteAnnotations, options: { renderRevision?: number | string } = {}) {
    const unsupported = new Set(annotations.unsupportedNoteIds.filter(Boolean));
    const supported = new Set(annotations.supportedNoteIds.filter(id => id && !unsupported.has(id)));
    const previous = [this.supportedNoteIds, this.unsupportedNoteIds];
    const next = [supported, unsupported];
    const rehydrate = this.currentContainer !== container || this.renderRevision !== (options.renderRevision ?? null);
    if (rehydrate) {
      for (const id of new Set([...previous, ...next].flatMap(ids => [...ids]))) {
        findScoreElementByRenderId(container, id)?.classList.remove(...annotationClasses);
      }
    }
    for (const [index, className] of annotationClasses.entries()) {
      for (const id of previous[index]) {
        if (!next[index].has(id) && !rehydrate) findScoreElementByRenderId(container, id)?.classList.remove(className);
      }
      for (const id of next[index]) {
        if (rehydrate || !previous[index].has(id)) findScoreElementByRenderId(container, id)?.classList.add(className);
      }
    }
    this.supportedNoteIds = supported;
    this.unsupportedNoteIds = unsupported;
    this.currentContainer = container;
    this.renderRevision = options.renderRevision ?? null;
  }
}

type TargetAnnotationsInput = readonly Readonly<{ strikes: readonly Readonly<{
  renderNoteIds: readonly string[];
  state: 'PENDING' | 'NOT_REACHED' | 'CORRECT' | 'MISSING' | 'SUPPORTED' | 'NOT_DETECTED';
}>[] }>[];

/** The same target colors in live Practice and completed Review. */
function targetAnnotations(groups: TargetAnnotationsInput): EvaluationNoteAnnotations {
  const supportedNoteIds: string[] = [], unsupportedNoteIds: string[] = [];
  for (const group of groups) for (const strike of group.strikes) {
    if (strike.state === 'CORRECT' || strike.state === 'SUPPORTED') supportedNoteIds.push(...strike.renderNoteIds);
    else if (strike.state === 'MISSING' || strike.state === 'NOT_DETECTED') unsupportedNoteIds.push(...strike.renderNoteIds);
  }
  return { supportedNoteIds, unsupportedNoteIds };
}
export function noteAnnotationsFromLiveFeedback(feedback: ContinuousLiveFeedback): EvaluationNoteAnnotations {
  return targetAnnotations(feedback.groups);
}
export function noteAnnotationsFromCompletedEvaluation(evaluation: CompletedContinuousEvaluation): EvaluationNoteAnnotations {
  return evaluation.status === 'UNAVAILABLE' ? { supportedNoteIds: [], unsupportedNoteIds: [] }
    : targetAnnotations(evaluation.interpretation.groups);
}
