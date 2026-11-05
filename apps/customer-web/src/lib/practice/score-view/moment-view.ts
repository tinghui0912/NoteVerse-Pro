import { attackNoteIds, notesForIds, type PracticeMoment, type PracticeScoreArtifact } from '@/lib/practice/score/artifact';

/** Read-only presentation values resolved from canonical moment note references. */
export type PracticeMomentView = Readonly<{
  groupId: string; onsetTick: number; canonicalEndTick: number;
  renderNoteIds: readonly string[]; measureNumbers: readonly string[];
}>;
export function projectPracticeMomentView(artifact: PracticeScoreArtifact, moment: PracticeMoment): PracticeMomentView {
  const notes = notesForIds(artifact, attackNoteIds(moment));
  return Object.freeze({ groupId: moment.groupId, onsetTick: moment.onsetTick, canonicalEndTick: moment.canonicalEndTick,
    renderNoteIds: Object.freeze(notes.map(note => note.renderNoteId)),
    measureNumbers: Object.freeze([...new Set(notes.map(note => note.measureNumber).filter(Boolean))]) });
}
export function projectPracticeMomentViews(artifact: PracticeScoreArtifact): readonly PracticeMomentView[] {
  return Object.freeze(artifact.moments.map(moment => projectPracticeMomentView(artifact, moment)));
}
