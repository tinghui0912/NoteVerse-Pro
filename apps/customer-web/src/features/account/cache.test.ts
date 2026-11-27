import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { principalIndependentQueryMeta } from '@/lib/query-auth-scope';
import { clearPrincipalServerState } from '@/features/authentication/cache';
import { accountResourcesDeleted } from './cache';

it('converges independent bearer resources for account erasure without redefining principal scope', async () => {
  const client = new QueryClient();
  const key = guestPreviewQueryKeys.public('bearer');
  await client.fetchQuery({queryKey:key,meta:principalIndependentQueryMeta,queryFn:async()=>({display_title:'Owned Score'})});
  clearPrincipalServerState(client);
  expect(client.getQueryData(key)).toEqual({display_title:'Owned Score'});
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await accountResourcesDeleted(client);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  client.clear();
});
