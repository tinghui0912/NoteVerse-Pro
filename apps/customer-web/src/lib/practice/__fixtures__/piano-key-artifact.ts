import fixture from './canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

/** Consistent canonical note/event/moment graph for domain tests. */
export function artifactWithKeys(steps: readonly (readonly number[])[]): PracticeScoreArtifact {
  const base = structuredClone(fixture) as PracticeScoreArtifact;
  base.ticksPerQuarter = 1;
  base.meterSegments = [{startTick:0,numerator:3,denominator:4}];
  base.scoreTempoSegments = [{startTick:0,bpm:120}];
  base.notes = []; base.events = []; base.moments = [];
  steps.forEach((keys, i) => {
    const eventId = `event-${i}`, groupId = `group-${i}`;
    base.events.push({ eventId, onsetTick: i, durationTicks: 1 });
    keys.forEach((pianoKey, k) => base.notes.push({ noteId: `note-${i}-${k}`, eventId, pianoKey,
      renderNoteId: `render-${i}-${k}`, measureNumber: String(i + 1), staffId: '1', voiceId: '1', tieTypes: [] }));
    base.moments.push({ groupId, onsetTick: i, canonicalEndTick: i + 1, continuationNoteIds: [],
      attacks: keys.map((pianoKey, k) => ({ attackId: `strike-${i}-${k}`, pianoKey, noteIds: [`note-${i}-${k}`] })) });
  });
  base.scoreEndTick = steps.length;
  return base;
}
