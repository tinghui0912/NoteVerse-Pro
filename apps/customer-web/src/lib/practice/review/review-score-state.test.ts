import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, it } from 'vitest';
const artifact = fixture as PracticeScoreArtifact;
import { resolveReviewScoreState } from './review-score-state';
describe('Review score rendering authority', () => {
  const result = canonicalContinuousResultFixture();
  const resolve = (source: PracticeScoreArtifact | null = artifact, xmlAvailable = true) =>
    resolveReviewScoreState({ sourceId: result.sourceId, result, artifact: source, xmlAvailable, scoreId: result.scoreId });
  it('confirms the current score identity without recomputing completed evaluation', () => {
    expect(resolve()).toMatchObject({ status: 'READY', scope: { kind: 'FULL' } });
    const evaluation = result.evaluation; resolve(); expect(result.evaluation).toBe(evaluation);
  });
  it.each(['scoreId', 'revisionId', 'artifactId'] as const)('fails closed on %s mismatch while leaving the result intact', key => {
    expect(resolve({ ...artifact, [key]: 'different' })).toMatchObject({ status: 'IDENTITY_MISMATCH' });
    expect(result.evaluation.status).toBe('COMPLETE');
  });
  it('keeps unavailable source distinct from an invalid range', () => {
    expect(resolve(null)).toMatchObject({ status: 'SOURCE_UNAVAILABLE' });
    expect(resolve(artifact, false)).toMatchObject({ status: 'SOURCE_UNAVAILABLE' });
    const ranged = { ...result, scope: { ...result.scope, kind: 'RANGE' as const, startGroupId: 'missing', endGroupId: 'missing', startIndex: 500, endIndex: 501 } };
    expect(resolveReviewScoreState({ sourceId: result.sourceId, result: ranged, artifact, xmlAvailable: true, scoreId: result.scoreId })).toMatchObject({ status: 'SCOPE_INVALID' });
  });
});

it('rejects a different source even with identical descriptive artifact identity', () => {
  const result = canonicalContinuousResultFixture();
  expect(resolveReviewScoreState({ result, artifact, sourceId: 'another', xmlAvailable: true, scoreId: result.scoreId })).toMatchObject({ status: 'IDENTITY_MISMATCH' });
});
