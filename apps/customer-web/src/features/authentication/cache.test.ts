import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { principalIndependentQueryMeta } from '@/lib/query-auth-scope';
import { clearPrincipalServerState } from './cache';

it('cancels unmarked private work, removes its cache and prevents late completion from restoring it', async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let signal!: AbortSignal;
  let finish!: (value: string) => void;
  const pending = client.fetchQuery({queryKey: ['private'], queryFn: context => {
    signal = context.signal;
    return new Promise<string>(resolve => {finish = resolve;});
  }}).catch(error => error);
  await client.fetchQuery({queryKey: ['other-meta'], meta: {purpose: 'display'}, queryFn: async () => 'private'});
  await client.fetchQuery({queryKey: ['bearer'], meta: principalIndependentQueryMeta, queryFn: async () => 'public'});
  const mutation = client.getMutationCache().build(client, {mutationFn: async () => 'private result'});
  await mutation.execute(undefined);

  clearPrincipalServerState(client);
  expect(signal.aborted).toBe(true);
  expect(client.getQueryState(['private'])).toBeUndefined();
  expect(client.getQueryState(['other-meta'])).toBeUndefined();
  expect(client.getQueryData(['bearer'])).toBe('public');
  expect(client.getMutationCache().getAll()).toEqual([]);
  finish('late private result');
  await pending;
  expect(client.getQueryState(['private'])).toBeUndefined();
  client.clear();
});
