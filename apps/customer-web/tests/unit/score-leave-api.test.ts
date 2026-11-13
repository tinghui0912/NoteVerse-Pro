import { scoreInvitesApi } from '@/lib/api/score-invites';
import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../helpers/customer-http';
afterEach(() => vi.unstubAllGlobals());
it('leaves the current membership through the generated command', async () => {
  const send = customerFetch();
  await scoreInvitesApi.leaveScore('shared-score');
  const request = send.mock.calls[0][0] as Request;
  expect(new URL(request.url).pathname).toBe('/api/v1/me/scores/shared-score/membership');
  expect(request.method).toBe('DELETE');
});
