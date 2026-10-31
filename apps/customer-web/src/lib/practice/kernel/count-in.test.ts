import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { countInContractAt } from '@/lib/practice/kernel/count-in';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}
describe('Meter-derived count-in', () => {
  it('derives count-in from active meter rather than a hardcoded four beats', () => {
    expect(countInContractAt(artifact, 0)).toEqual({
      durationBeats: 3,
      pulses: 3,
      numerator: 3,
      denominator: 4,
    });
    expect(countInContractAt(artifact, 3)).toEqual({
      durationBeats: 3,
      pulses: 6,
      numerator: 6,
      denominator: 8,
    });
    expect(() => countInContractAt(cloneArtifact({ meterSegments: [] }), 0)).toThrow('initial meter');
    expect(() => countInContractAt(cloneArtifact({ meterSegments: [{ ...artifact.meterSegments[0], startBeat: 1 }] }), 0)).toThrow('initial meter');
  });
});
