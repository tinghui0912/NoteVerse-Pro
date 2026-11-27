import type {
  PracticeScoreArtifact,
  PracticeScoreNote,
  PracticeMoment,
} from '@/lib/practice/contracts/generated/score-artifact';
export type {
  PracticeScoreArtifact,
  PracticeScoreNote,
  PracticeMoment,
  MeterSegment,
  TempoSegment,
} from '@/lib/practice/contracts/generated/score-artifact';
export { measureDurationTicks } from './score-time';

/** Consumer projection of an already admitted canonical graph. */
export function notesForIds(
  artifact: PracticeScoreArtifact,
  ids: readonly string[],
): readonly PracticeScoreNote[] {
  const notes = new Map(artifact.notes.map((note) => [note.noteId, note]));
  return ids.map((id) => {
    const note = notes.get(id);
    if (!note) throw new Error('Dangling admitted canonical note reference.');
    return note;
  });
}
export function attackNoteIds(moment: PracticeMoment): string[] {
  return moment.attacks.flatMap((attack) => attack.noteIds);
}
