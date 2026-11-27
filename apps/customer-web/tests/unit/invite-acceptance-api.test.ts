import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import type { InviteAcceptRead } from '@/generated/api';
import { collaborationApi } from '@/features/scores/collaboration/api';
import { customerFetch } from '../helpers/customer-http';

afterEach(() => vi.unstubAllGlobals());

it.each(['token', 'pending'] as const)(
  'returns a required generated membership identity from %s acceptance',
  async (endpoint) => {
    expectTypeOf<InviteAcceptRead['membership_id']>().toEqualTypeOf<number>();
    const accepted = { membership_id: 42, role: 'VIEWER', score_id: 'shared-score' } satisfies InviteAcceptRead;
    customerFetch(accepted);
    const result = endpoint === 'token'
      ? await collaborationApi.acceptInvite('invite-token')
      : await collaborationApi.acceptMyPendingInvite('invite-id');
    expectTypeOf(result.membership_id).toEqualTypeOf<number>();
    expect(result).toEqual(accepted);
  },
);
