import { describe, expect, it } from 'vitest';
import { getCompletedScoreRoute } from '@/components/upload/upload-types';

describe('upload score navigation', () => {
  it('routes review scores and completed scores to their product pages', () => {
    expect(getCompletedScoreRoute('review-score', 'PENDING_REVIEW')).toBe('/score/review-score/review');
    expect(getCompletedScoreRoute('result-score', 'SUCCESS')).toBe('/score/result-score');
  });
});
