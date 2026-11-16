import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import type { InviteAcceptRead } from '@/generated/api';
import { scoreInvitesApi } from '@/lib/api/score-invites';
import { customerFetch } from '../helpers/customer-http';

afterEach(() => vi.unstubAllGlobals());

it.each(['token', 'pending'] as const)(
  'returns a required generated membership identity from %s acceptance',
  async (endpoint) => {
    expectTypeOf<InviteAcceptRead['membership_id']>().toEqualTypeOf<number>();
    const accepted = { membership_id: 42, role: 'VIEWER', score_id: 'shared-score' } satisfies InviteAcceptRead;
    customerFetch(accepted);
    const result = endpoint === 'token'
      ? await scoreInvitesApi.acceptInvite('invite-token')
      : await scoreInvitesApi.acceptMyPendingInvite('invite-id');
    expectTypeOf(result.membership_id).toEqualTypeOf<number>();
    expect(result).toEqual(accepted);
  },
);
