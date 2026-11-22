import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { collaborationApi } from '@/features/scores/collaboration/api';
afterEach(() => vi.unstubAllGlobals());
it.each([collaborationApi.listInvites.bind(null, 'score'), collaborationApi.listMembers.bind(null, 'score'), collaborationApi.listMyPendingInvites])('passes opaque continuation through generated queries', async (list) => {
  const send = customerFetch({ items: [], next_cursor: 'next' });
  const signal = new AbortController().signal;
  const result = await list({ limit: 25, cursor: 'opaque+/=?', signal });
  expect(result?.next_cursor).toBe('next');
  const request = send.mock.calls[0][0] as Request;
  expect(new URL(request.url).searchParams.get('cursor')).toBe('opaque+/=?');
  expect(new URL(request.url).searchParams.get('limit')).toBe('25');
  expect(request.signal.aborted).toBe(false);
});
