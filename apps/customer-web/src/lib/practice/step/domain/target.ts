import type { PracticePianoKey } from '@/lib/practice/kernel/piano-key';
import { notesForIds, type PracticeMoment, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export function groupForStep(artifact: PracticeScoreArtifact, stepIndex: number): PracticeMoment | null {
  return artifact.moments[stepIndex] ?? null;
}
export function attackKeysForStep(moment: PracticeMoment): PracticePianoKey[] {
  return moment.attacks.map(attack => attack.pianoKey);
}
export function continuationKeysForStep(artifact: PracticeScoreArtifact, moment: PracticeMoment): PracticePianoKey[] {
  return [...new Set(notesForIds(artifact, moment.continuationNoteIds).map(note => note.pianoKey))];
}
