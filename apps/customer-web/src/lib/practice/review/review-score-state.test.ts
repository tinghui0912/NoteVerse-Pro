import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, it } from 'vitest';
const artifact = fixture as PracticeScoreArtifact;
import { resolveReviewScoreState } from './review-score-state';
describe('Review score rendering authority', () => {
  const result = canonicalContinuousResultFixture();
  const resolve = (source: PracticeScoreArtifact | null = artifact, xmlAvailable = true) =>
    resolveReviewScoreState({ result, artifact: source, xmlAvailable, scoreId: result.scoreId });
  it('confirms the current score identity without projecting new metrics', () => {
    expect(resolve()).toMatchObject({ status: 'READY', scope: { kind: 'FULL' } });
    const metrics = result.metrics; resolve(); expect(result.metrics).toBe(metrics);
  });
  it.each(['scoreId', 'revisionId', 'artifactId'] as const)('fails closed on %s mismatch while leaving the result intact', key => {
    expect(resolve({ ...artifact, [key]: 'different' })).toMatchObject({ status: 'IDENTITY_MISMATCH' });
    expect(result.metrics.targetStrikeCount).toBeGreaterThan(0);
  });
  it('keeps unavailable source distinct from an invalid range', () => {
    expect(resolve(null)).toMatchObject({ status: 'SOURCE_UNAVAILABLE' });
    expect(resolve(artifact, false)).toMatchObject({ status: 'SOURCE_UNAVAILABLE' });
    const ranged = { ...result, scope: { ...result.scope, kind: 'RANGE' as const, startGroupId: 'missing', endGroupId: 'missing', startIndex: 500, endIndex: 501 } };
    expect(resolveReviewScoreState({ result: ranged, artifact, xmlAvailable: true, scoreId: result.scoreId })).toMatchObject({ status: 'SCOPE_INVALID' });
  });
});
