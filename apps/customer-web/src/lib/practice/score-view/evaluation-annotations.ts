import { findScoreElementByRenderId } from './dom';
import { REPORT_NOTE_CLASSES } from './decorations';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousLiveFeedback } from '@/lib/practice/continuous/domain/evaluation/live-feedback';

type EvaluationNoteAnnotations = {
  supportedNoteIds: string[];
  wrongNoteIds: string[];
  missedNoteIds: string[];
};
const annotationClasses = REPORT_NOTE_CLASSES;

export class EvaluationAnnotationController {
  private supportedNoteIds = new Set<string>();
  private wrongNoteIds = new Set<string>();
  private missedNoteIds = new Set<string>();
  private currentContainer: HTMLElement | null = null;
  private renderRevision: number | string | null = null;

  clear(container: HTMLElement) {
    for (const id of new Set([...this.supportedNoteIds, ...this.wrongNoteIds, ...this.missedNoteIds])) {
      findScoreElementByRenderId(container, id)?.classList.remove(...annotationClasses);
    }
    this.supportedNoteIds.clear();
    this.wrongNoteIds.clear();
    this.missedNoteIds.clear();
    this.currentContainer = null;
    this.renderRevision = null;
  }

  apply(container: HTMLElement, annotations: EvaluationNoteAnnotations, options: { renderRevision?: number | string } = {}) {
    const wrong = new Set(annotations.wrongNoteIds.filter(Boolean));
    const supported = new Set(annotations.supportedNoteIds.filter(id => id && !wrong.has(id)));
    const missed = new Set(annotations.missedNoteIds.filter(id => id && !wrong.has(id) && !supported.has(id)));
    const previous = [this.supportedNoteIds, this.wrongNoteIds, this.missedNoteIds];
    const next = [supported, wrong, missed];
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
    this.wrongNoteIds = wrong;
    this.missedNoteIds = missed;
    this.currentContainer = container;
    this.renderRevision = options.renderRevision ?? null;
  }
}

function annotationsFromInterpretation(interpretation: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>['interpretation']): EvaluationNoteAnnotations {
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
export function noteAnnotationsFromLiveFeedback(feedback: ContinuousLiveFeedback): EvaluationNoteAnnotations {
  return { supportedNoteIds: feedback.groups.flatMap(group => group.strikes.filter(strike => strike.state === 'CORRECT' || strike.state === 'SUPPORTED').flatMap(strike => strike.renderNoteIds)),
    missedNoteIds: feedback.groups.flatMap(group => group.strikes.filter(strike => strike.state === 'MISSING').flatMap(strike => strike.renderNoteIds)),
    wrongNoteIds: [] };
}
export function noteAnnotationsFromCompletedEvaluation(evaluation: CompletedContinuousEvaluation): EvaluationNoteAnnotations {
  return evaluation.status === 'UNAVAILABLE' ? { supportedNoteIds: [], wrongNoteIds: [], missedNoteIds: [] }
    : annotationsFromInterpretation(evaluation.interpretation);
}
