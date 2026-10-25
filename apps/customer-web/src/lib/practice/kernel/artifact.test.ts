import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
describe('Canonical PracticeScoreArtifact', () => {
  it("retains canonical artifact identity, attack targets and continuations", () => {

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.artifactId).toBe('practice-score-artifact:ec2262af8d689ffb');
    expect(artifact.expectedPracticeGroups.map((group) => group.pitches)).toEqual([
      ['C4'],
      ['C4'],
      ['G4'],
      ['A4', 'C5'],
      ['D5'],
    ]);

    expect(artifact.practiceAttackSteps[3]).toMatchObject({
      attackTargets: [{ pitch: 'A4' }, { pitch: 'C5' }],
      continuation: [{ pitch: 'G4' }],
    });

  });
});
