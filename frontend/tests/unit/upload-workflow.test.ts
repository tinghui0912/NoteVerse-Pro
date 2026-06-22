import { describe, expect, it } from 'vitest';
import { getCompletedScoreRoute } from '@/components/upload/upload-types';

describe('upload score navigation', () => {
  it('routes review scores and completed results to their product pages', () => {
    expect(getCompletedScoreRoute('review-score', 'PENDING_REVIEW')).toBe('/review/review-score');
    expect(getCompletedScoreRoute('result-score', 'SUCCESS')).toBe('/results/result-score');
  });
});
