import { expect, it, vi } from 'vitest';
import { scoreInvitesApi } from '@/lib/api/score-invites';
const client = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: client }));
it('leaves the authenticated user membership by public Score identity', () => {
  scoreInvitesApi.leaveScore('shared-score');
  expect(client.delete).toHaveBeenCalledExactlyOnceWith(
    '/me/scores/shared-score/membership',
  );
});
