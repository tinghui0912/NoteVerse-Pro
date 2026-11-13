import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { scoreInvitesApi } from './score-invites';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));
beforeEach(() => vi.mocked(apiClient.get).mockReset());

it.each([
  [
    '/scores/score/invites',
    (options: { limit: number; cursor: string; signal: AbortSignal }) =>
      scoreInvitesApi.listInvites('score', options),
  ],
  [
    '/scores/score/members',
    (options: { limit: number; cursor: string; signal: AbortSignal }) =>
      scoreInvitesApi.listMembers('score', options),
  ],
  ['/me/invites', scoreInvitesApi.listMyPendingInvites],
])('passes opaque continuation and cancellation to %s', async (path, list) => {
  const signal = new AbortController().signal;
  const response = { success: true, data: { items: [], next_cursor: 'uninterpreted-next' } };
  vi.mocked(apiClient.get).mockResolvedValue(response);
  expect(await list({ limit: 25, cursor: 'opaque_cursor-from-server', signal })).toBe(response);
  expect(apiClient.get).toHaveBeenCalledWith(
    path,
    { limit: 25, cursor: 'opaque_cursor-from-server' },
    { signal },
  );
});
