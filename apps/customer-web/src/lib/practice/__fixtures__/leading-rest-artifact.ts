import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import fixture from './canonical-practice-score-artifact.json';
const artifact = fixture as PracticeScoreArtifact;
function cloneArtifact(overrides: Partial<PracticeScoreArtifact>): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}

// Piece has leading rest: beat 0.0 to 2.0 is rest. First playable note is at beat 2.0.
// Meter is 4/4.
// Score tempo segments: 0.0 -> 80 BPM (score tempo), 2.0 -> 100 BPM (score tempo at first note).
const firstGroup = {
  ...artifact.expectedPracticeGroups[0],
  groupId: 'g-rest-1',
  onsetBeat: 2.0,
  canonicalEndBeat: 3.0,
};
const firstStep = {
  ...artifact.practiceAttackSteps[0],
  stepId: 's-rest-1',
  groupId: 'g-rest-1',
  onsetBeat: 2.0,
};
const leadingRestArtifact = cloneArtifact({
  meterSegments: [
    {
      startBeat: 0.0,
      numerator: 4,
      denominator: 4,
      measureDurationBeats: 4.0,
      countInPulses: 4,
      source: 'MUSICXML',
    },
  ],
  scoreTempoSegments: [
    { startBeat: 0.0, bpm: 80 },
    { startBeat: 2.0, bpm: 100 },
  ],
  expectedPracticeGroups: [firstGroup],
  practiceAttackSteps: [firstStep],
});


export { leadingRestArtifact };
