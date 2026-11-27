// @vitest-environment jsdom
import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAccountSecurity, useChangePassword, useRequestEmailChange } from './security/queries';
import { useAccountSessions, useRevokeSession, useRevokeOtherSessions } from './sessions/queries';
import { accountQueryKeys } from './query-keys';
import { notificationQueryKeys } from '@/features/notifications/query-keys';
import { libraryQueryKeys } from '@/features/library/query-keys';
import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import { importQueryKeys } from '@/features/imports/query-keys';

const api = vi.hoisted(() => ({
  security: { getSecurityOverview: vi.fn(), changePassword: vi.fn(), requestEmailChange: vi.fn() },
  sessions: { getSessions: vi.fn(), revokeSession: vi.fn(), revokeOtherSessions: vi.fn() },
}));
vi.mock('./security/api', () => ({accountSecurityApi: api.security}));
vi.mock('./sessions/api', () => ({accountSessionsApi: api.sessions}));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
});
afterEach(() => client.clear());
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it.each(['password', 'session', 'others', 'email-request'] as const)('%s converges only its admitted Account projections', async (action) => {
  const security = accountQueryKeys.security();
  const sessions = accountQueryKeys.sessions();
  const unrelated = [notificationQueryKeys.list(), libraryQueryKeys.folders(), scoreQueryKeys.detail('score'), importQueryKeys.review('job'), storageUsageQueryKeys.current()];
  const old = {security: {email: 'old@example.com', email_verified_at: null}};
  client.setQueryData(security, old);
  for (const key of [sessions, ...unrelated]) client.setQueryData(key, {cached: true});
  const hook = renderHook(() => ({
    password: useChangePassword(), session: useRevokeSession(), others: useRevokeOtherSessions(), request: useRequestEmailChange(),
  }), {wrapper});
  await act(async () => {
    if (action === 'password') await hook.result.current.password.mutateAsync({currentPassword: 'current', newPassword: 'new-password', locale: 'en'});
    else if (action === 'session') await hook.result.current.session.mutateAsync(2);
    else if (action === 'others') await hook.result.current.others.mutateAsync();
    else await hook.result.current.request.mutateAsync({new_email: 'new@example.com', current_password: 'current', locale: 'en'});
  });
  expect(client.getQueryState(security)?.isInvalidated).toBe(action === 'password');
  expect(client.getQueryState(sessions)?.isInvalidated).toBe(action !== 'email-request');
  expect(unrelated.every(key => !client.getQueryState(key)?.isInvalidated)).toBe(true);
  expect(client.getQueryData(security)).toEqual(old);
  if (action === 'password') expect(api.security.changePassword).toHaveBeenCalledWith('current', 'new-password', 'en');
  if (action === 'session') expect(api.sessions.revokeSession).toHaveBeenCalledWith(2);
  if (action === 'others') expect(api.sessions.revokeOtherSessions).toHaveBeenCalledOnce();
  if (action === 'email-request') expect(api.security.requestEmailChange).toHaveBeenCalledWith({new_email: 'new@example.com', current_password: 'current', locale: 'en'});
});

it('does not mark projections changed when password verification fails', async () => {
  for (const key of [accountQueryKeys.security(), accountQueryKeys.sessions()]) client.setQueryData(key, {});
  api.security.changePassword.mockRejectedValue(new Error('rejected'));
  const hook = renderHook(() => useChangePassword(), {wrapper});
  await act(async () => { await expect(hook.result.current.mutateAsync({currentPassword: 'bad', newPassword: 'new-password', locale: 'en'})).rejects.toThrow('rejected'); });
  expect([accountQueryKeys.security(), accountQueryKeys.sessions()].every(key => !client.getQueryState(key)?.isInvalidated)).toBe(true);
});

it('places Security and Sessions reads under their Account query identities', async () => {
  const security = {security: {email: 'current@example.com'}};
  const sessions = {sessions: []};
  api.security.getSecurityOverview.mockResolvedValue(security);
  api.sessions.getSessions.mockResolvedValue(sessions);
  const hook = renderHook(() => ({security: useAccountSecurity(), sessions: useAccountSessions()}), {wrapper});
  await waitFor(() => expect(hook.result.current.security.isSuccess && hook.result.current.sessions.isSuccess).toBe(true));
  expect(client.getQueryData(accountQueryKeys.security())).toEqual(security);
  expect(client.getQueryData(accountQueryKeys.sessions())).toEqual(sessions);
  expect(api.security.getSecurityOverview).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(api.sessions.getSessions).toHaveBeenCalledWith(expect.any(AbortSignal));
});
