import { expect, it, vi } from 'vitest';
import { importJobsApi } from '@/lib/api/import-jobs';
const client = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: client }));
it('retries an existing ImportJob through its command endpoint', () => {
  importJobsApi.retryImportJob('failed-job');
  expect(client.post).toHaveBeenCalledExactlyOnceWith(
    '/import-jobs/failed-job/retry',
  );
});
