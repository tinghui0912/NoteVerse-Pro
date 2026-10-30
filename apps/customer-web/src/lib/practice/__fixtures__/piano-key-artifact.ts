import fixture from './canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

/** Consistent canonical note/event/moment graph for domain tests. */
export function artifactWithKeys(steps: readonly (readonly number[])[]): PracticeScoreArtifact {
  const base = structuredClone(fixture) as PracticeScoreArtifact;
  base.notes = []; base.events = []; base.moments = [];
  steps.forEach((keys, i) => {
    const eventId = `event-${i}`, groupId = `group-${i}`;
    base.events.push({ eventId, onsetBeat: i, durationBeats: 1 });
    keys.forEach((pianoKey, k) => base.notes.push({ noteId: `note-${i}-${k}`, eventId, pianoKey,
      renderNoteId: `render-${i}-${k}`, measureNumber: String(i + 1), staffId: '1', voiceId: '1', tieTypes: [] }));
    base.moments.push({ groupId, onsetBeat: i, canonicalEndBeat: i + 1, continuationNoteIds: [],
      attacks: keys.map((pianoKey, k) => ({ attackId: `strike-${i}-${k}`, pianoKey, noteIds: [`note-${i}-${k}`] })) });
  });
  base.firstPlayableBeat = 0; base.scoreEndBeat = steps.length;
  return base;
}
