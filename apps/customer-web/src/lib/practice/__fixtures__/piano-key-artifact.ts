import fixture from './canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

/** Internally consistent score facts for tests; no private target injection. */
export function artifactWithKeys(steps: readonly (readonly number[])[]): PracticeScoreArtifact {
  const base = structuredClone(fixture) as PracticeScoreArtifact;
  base.playableEvents = []; base.expectedPracticeGroups = []; base.practiceAttackSteps = [];
  steps.forEach((keys, i) => {
    const eventId = `event-${i}`, renderNoteIds = keys.map((_, k) => `render-${i}-${k}`);
    const metadata = { measureNumbers: [String(i + 1)], staffIds: ['1'], voiceIds: ['1'] };
    const event = { ...metadata, eventId, pianoKeys: [...keys], renderNoteIds, onsetBeat: i, durationBeats: 1,
      tieTypes: [], playable: true, entryCandidate: true };
    base.playableEvents.push(event);
    const expectedNotes = keys.map((pianoKey, k) => ({ expectedNoteId: `note-${i}-${k}`, eventId, pianoKey,
      renderNoteId: renderNoteIds[k], measureNumbers: metadata.measureNumbers }));
    const notes = expectedNotes.map(note => ({ ...metadata, stepNoteId: note.expectedNoteId, ...note }));
    base.expectedPracticeGroups.push({ ...metadata, groupId: `group-${i}`, onsetBeat: i, canonicalEndBeat: i + 1,
      pianoKeys: [...keys], eventIds: [eventId], renderNoteIds, expectedNotes,
      strikeTargets: keys.map((pianoKey, k) => ({ strikeId: `strike-${i}-${k}`, pianoKey, expectedNotes: [expectedNotes[k]],
        eventIds: [eventId], renderNoteIds: [renderNoteIds[k]], measureNumbers: metadata.measureNumbers })) });
    base.practiceAttackSteps.push({ ...metadata, stepId: `step-${i}`, onsetBeat: i, eventIds: [eventId], renderNoteIds,
      continuation: [], attackTargets: keys.map((pianoKey, k) => ({ attackId: `attack-${i}-${k}`, pianoKey, notes: [notes[k]],
        eventIds: [eventId], renderNoteIds: [renderNoteIds[k]], measureNumbers: metadata.measureNumbers })) });
  });
  base.firstPlayableBeat = 0; base.scoreEndBeat = steps.length;
  return base;
}
