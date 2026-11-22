import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import type { ImportJobRead, ImportJobReviewRead } from '@/generated/api';
import { scoresDeleted, scoreLeft } from '@/lib/cache-effects/scores';
import { importQueryKeys } from './query-keys';

it.each(['delete', 'leave'] as const)(
  '%s applies the correct Score lifetime consequence to all Import projections', async (command) => {
    const client = new QueryClient();
    const job: ImportJobRead = {
      job_id: 'job', state: 'CONFIRMED', score_id: 'score', progress: 100,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const review: ImportJobReviewRead = { ...job, genres: [], original_images: [] };
    const unrelatedReview: ImportJobReviewRead = { ...review, job_id: 'other-job', score_id: 'other-score' };
    const projections = [
      [importQueryKeys.jobs.list(1, 20), { items: [job] }],
      [importQueryKeys.jobs.detail('job'), job],
      [importQueryKeys.review('job'), review],
      [importQueryKeys.review('other-job'), unrelatedReview],
    ] as const;
    for (const [key, value] of projections) client.setQueryData(key, value);
    if (command === 'delete') await scoresDeleted(client, ['score']);
    else await scoreLeft(client, 'score');
    for (const [key, value] of projections) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(command === 'delete');
      expect(client.getQueryData(key)).toEqual(value);
    }
    client.clear();
  },
);
