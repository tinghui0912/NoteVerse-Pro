import { describe, expect, it } from 'vitest';
import { getCompletedJobRoute } from '@/components/upload/upload-types';

describe('upload score navigation', () => {
  it('routes review jobs and completed scores to their product pages', () => {
    expect(getCompletedJobRoute('review-job', null, 'PENDING_REVIEW')).toBe('/review/review-job');
    expect(getCompletedJobRoute('result-job', 'result-score', 'SUCCESS')).toBe('/score/result-score');
  });
});
