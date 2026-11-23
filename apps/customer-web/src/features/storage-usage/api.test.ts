import { expect, it, vi } from 'vitest';
import { accountStorageUsageGet } from '@/generated/api';
import { customerTransport } from '@/lib/http/customer-browser-transport';
import { storageUsageApi } from './api';
vi.mock('@/generated/api', () => ({accountStorageUsageGet: vi.fn()}));
it('adapts the generated authenticated read without copying its representation', async () => {
  const data = {quota: {used_bytes: 10, reserved_bytes: 2, limit_bytes: 100, available_bytes: 88}, breakdown: []};
  vi.mocked(accountStorageUsageGet).mockResolvedValue({data, request: new Request('http://localhost/api/v1/me/storage-usage'), response: new Response()});
  const signal = new AbortController().signal;
  expect(await storageUsageApi.current(signal)).toBe(data);
  expect(accountStorageUsageGet).toHaveBeenCalledWith({...customerTransport.authenticated, signal});
});
