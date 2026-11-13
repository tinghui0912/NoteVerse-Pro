import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { scoreInvitesApi } from './score-invites';
afterEach(() => vi.unstubAllGlobals());
it.each([scoreInvitesApi.listInvites.bind(null, 'score'), scoreInvitesApi.listMembers.bind(null, 'score'), scoreInvitesApi.listMyPendingInvites])('passes opaque continuation through generated queries', async (list) => {
  const send = customerFetch({ items: [], next_cursor: 'next' });
  const signal = new AbortController().signal;
  const result = await list({ limit: 25, cursor: 'opaque+/=?', signal });
  expect(result.data?.next_cursor).toBe('next');
  const request = send.mock.calls[0][0] as Request;
  expect(new URL(request.url).searchParams.get('cursor')).toBe('opaque+/=?');
  expect(new URL(request.url).searchParams.get('limit')).toBe('25');
  expect(request.signal.aborted).toBe(false);
});
