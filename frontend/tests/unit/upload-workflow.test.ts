import { describe, expect, it } from 'vitest';
import { getCompletedTaskRoute } from '@/components/upload/upload-types';

describe('upload task navigation', () => {
  it('routes review tasks and completed results to their product pages', () => {
    expect(getCompletedTaskRoute('review-task', 'PENDING_REVIEW')).toBe('/review/review-task');
    expect(getCompletedTaskRoute('result-task', 'SUCCESS')).toBe('/results/result-task');
  });
});
