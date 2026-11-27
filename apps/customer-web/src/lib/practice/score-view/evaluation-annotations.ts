import { findScoreElementByRenderId } from './dom';
import { REPORT_NOTE_CLASSES } from './decorations';
import type { ContinuousTargetFeedback } from '@/lib/practice/continuous/domain/evaluation/target-feedback';

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

/** One mapper for live Practice and completed Review, consuming settled assignment truth only. */
export function noteAnnotationsFromTargetFeedback(feedback: ContinuousTargetFeedback): EvaluationNoteAnnotations {
  const supportedNoteIds: string[] = [], unsupportedNoteIds: string[] = [];
  for (const target of feedback.targets) {
    if (target.state === 'MATCHED') supportedNoteIds.push(...target.renderNoteIds);
    else unsupportedNoteIds.push(...target.renderNoteIds);
  }
  return { supportedNoteIds, unsupportedNoteIds };
}
