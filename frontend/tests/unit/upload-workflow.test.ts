import { describe, expect, it } from 'vitest';
import { getCompletedJobRoute } from '@/lib/upload/upload-workflow';

describe('upload score navigation', () => {
  it('routes review jobs and completed scores to their product pages', () => {
    expect(getCompletedJobRoute('review-job', null, 'PENDING_REVIEW')).toBe('/review/review-job');
    expect(getCompletedJobRoute('result-job', 'result-score', 'CONFIRMED')).toBe('/score/result-score');
  });
});
