import { importJobsApi } from '@/features/imports/api/jobs';
import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../helpers/customer-http';
afterEach(() => vi.unstubAllGlobals());
it('retries an existing ImportJob with the generated command', async () => {
  const send = customerFetch();
  await importJobsApi.retryImportJob('failed/job');
  const request = send.mock.calls[0][0] as Request;
  expect(new URL(request.url).pathname).toBe('/api/v1/import-jobs/failed%2Fjob/retry');
  expect(request.method).toBe('POST');
});
