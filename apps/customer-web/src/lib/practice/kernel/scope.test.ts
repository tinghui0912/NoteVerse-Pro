import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { leadingRestArtifact } from '@/lib/practice/__fixtures__/leading-rest-artifact';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { entryGroupEndBeat, resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
describe('Canonical practice scope', () => {
  it("uses the entry group canonical end for scope termination", () => {
    expect(entryGroupEndBeat(artifact, artifact.expectedPracticeGroups[2].groupId)).toBe(4.5);
  });

  it("starts full scope at its first expected onset after a leading rest", () => {
    // Unconditional resolvePracticeScope:
    const resolvedScope = resolvePracticeScope(leadingRestArtifact, { kind: 'FULL' });
    expect(resolvedScope.startBeat).toBe(2.0);
    expect(resolvedScope.startIndex).toBe(0);
    expect(leadingRestArtifact.expectedPracticeGroups[resolvedScope.startIndex].groupId).toBe('g-rest-1');


  });
});
