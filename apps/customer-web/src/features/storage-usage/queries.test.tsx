// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useStorageUsage } from './queries';
import { storageUsageQueryKeys } from './query-keys';
import { storageUsageChanged } from './cache';

const fake = vi.hoisted(() => ({current: vi.fn()}));
vi.mock('./api', () => ({storageUsageApi: {current: fake.current}}));
it('reads the current projection with an AbortSignal and converges through the domain consequence', async () => {
  const data = {quota: {used_bytes: 10, reserved_bytes: 0, limit_bytes: 100, available_bytes: 90}, breakdown: []};
  fake.current.mockResolvedValue(data);
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useStorageUsage(), {wrapper});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(fake.current.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  expect(client.getQueryData(storageUsageQueryKeys.current())).toEqual(data);
  hook.unmount();
  client.setQueryData(['unrelated'], {keep: true});
  await storageUsageChanged(client);
  expect(client.getQueryState(storageUsageQueryKeys.current())?.isInvalidated).toBe(true);
  expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
  client.clear();
});

it('identifies the current usage projection under Storage Usage', () => {
  expect(storageUsageQueryKeys.all).toEqual(['storage-usage']);
  expect(storageUsageQueryKeys.current()).toEqual(['storage-usage', 'current']);
});
