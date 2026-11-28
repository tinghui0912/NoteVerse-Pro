// @vitest-environment jsdom
import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProfileUserRead } from '@/generated/api';
import { AuthenticationProvider, useAuthentication } from './authentication-context';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { libraryQueryKeys } from '@/features/library/query-keys';
import { notificationQueryKeys } from '@/features/notifications/query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import { accountQueryKeys } from '@/features/account/query-keys';
import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { principalIndependentQueryMeta } from '@/lib/query-auth-scope';
import { queryKeys } from '@/lib/query-client';
import { invalidateSession } from '@/lib/http/session-invalidation';

const fake = vi.hoisted(() => ({profile: vi.fn(), login: vi.fn(), logout: vi.fn(), navigate: vi.fn(), report: vi.fn()}));
vi.mock('@/features/account/profile/api', () => ({profileApi: {getProfile: fake.profile}}));
vi.mock('../api', () => ({authenticationApi: {login: fake.login, logout: fake.logout}}));
vi.mock('./document-navigation', () => ({navigateToLogin: fake.navigate}));
vi.mock('@/lib/observability', () => ({reportUnexpectedClientError: fake.report}));
const principal: ProfileUserRead = {id: 1, email: 'a@example.com', display_name: 'A', avatar_url: '/avatar.jpg', is_active: true};
let client: QueryClient;
beforeEach(() => {vi.resetAllMocks(); client = new QueryClient({defaultOptions: {queries: {retry: false}}});});
afterEach(() => client.clear());
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}><AuthenticationProvider>{children}</AuthenticationProvider></QueryClientProvider>;
const privateKeys = () => [libraryQueryKeys.folders(), notificationQueryKeys.list(), collaborationQueryKeys.myInvites(), scoreQueryKeys.detail('score'), accountQueryKeys.security(), accountQueryKeys.sessions(), storageUsageQueryKeys.current(), queryKeys.performanceTakes.list(), guestPreviewQueryKeys.settings('score'), collaborationQueryKeys.inviteAccess('token')];
function seedPrivateState() {for (const key of privateKeys()) client.setQueryData(key, {private: 'A'});}
const bearerKey = guestPreviewQueryKeys.public('bearer');
async function seedBearerState() {
  await client.fetchQuery({queryKey: bearerKey, meta: principalIndependentQueryMeta, queryFn: async () => ({display_title: 'Guest Score'})});
}
function expectBearerRetained() {expect(client.getQueryData(bearerKey)).toEqual({display_title: 'Guest Score'});}
const anonymous = () => new ApiError(401, 'token_invalid_expired');

it('clears principal and sensitive queries on authenticated HTTP rejection', async () => {
  fake.profile.mockResolvedValue({user: principal});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  seedPrivateState();
  await seedBearerState();
  act(() => invalidateSession());
  expect(hook.result.current.status).toBe('anonymous');
  expect(privateKeys().every(key => !client.getQueryState(key))).toBe(true);
  expectBearerRetained();
  expect(fake.profile).toHaveBeenCalledOnce();
});

it.each(['authenticated', 'anonymous', 'server-error', 'network-error'] as const)('discovers bootstrap %s without redirecting', async (kind) => {
  if (kind === 'authenticated') fake.profile.mockResolvedValue({user: principal});
  else fake.profile.mockRejectedValue(kind === 'anonymous' ? anonymous() : kind === 'server-error' ? new ApiError(503, 'internal_error') : new TypeError('offline'));
  const hook = renderHook(() => useAuthentication(), {wrapper});
  expect(hook.result.current.status).toBe('bootstrapping');
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(hook.result.current.status).toBe(kind.endsWith('error') ? 'unavailable' : kind);
  expect(hook.result.current.isAuthenticated).toBe(kind === 'authenticated');
  expect(hook.result.current.principal).toEqual(kind === 'authenticated' ? principal : null);
  expect(fake.profile).toHaveBeenCalledWith({suppressAuthRedirect: true});
  expect(fake.report).toHaveBeenCalledTimes(kind.endsWith('error') ? 1 : 0);
  expect(fake.navigate).not.toHaveBeenCalled();
});

it.each(['success', 'unauthorized', 'unavailable'] as const)('refreshes an established principal with %s semantics', async (kind) => {
  fake.profile.mockResolvedValue({user: principal});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  seedPrivateState();
  await seedBearerState();
  const updated = {...principal, email: 'updated@example.com'};
  const failure = kind === 'unauthorized' ? anonymous() : new Error('transient failure');
  if (kind === 'success') fake.profile.mockResolvedValue({user: updated});
  else fake.profile.mockRejectedValue(failure);
  await act(async () => {
    if (kind === 'unavailable') await expect(hook.result.current.refreshPrincipal()).rejects.toBe(failure);
    else await hook.result.current.refreshPrincipal();
  });
  expect(hook.result.current.principal).toEqual(kind === 'success' ? updated : kind === 'unauthorized' ? null : principal);
  expect(hook.result.current.status).toBe(kind === 'unauthorized' ? 'anonymous' : 'authenticated');
  expect(privateKeys().every(key => client.getQueryState(key) === undefined)).toBe(kind === 'unauthorized');
  expectBearerRetained();
  expect(fake.report).toHaveBeenCalledTimes(kind === 'unavailable' ? 1 : 0);
});

it('establishes login directly from its principal body and clears previous principal caches', async () => {
  fake.profile.mockRejectedValue(anonymous());
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.status).toBe('anonymous'));
  seedPrivateState();
  await seedBearerState();
  const next = {...principal, id: 2, email: 'b@example.com'};
  fake.login.mockResolvedValue(next);
  await act(async () => hook.result.current.signIn('b@example.com', 'password'));
  expect(hook.result.current.principal).toEqual(next);
  expect(hook.result.current.status).toBe('authenticated');
  expect(fake.profile).toHaveBeenCalledOnce();
  expect(fake.login).toHaveBeenCalledWith('b@example.com', 'password');
  expectBearerRetained();
  expect(privateKeys().every(key => !client.getQueryState(key))).toBe(true);
});

it.each([true, false])('logs out and clears principal/server state only on server success=%s', async (success) => {
  fake.profile.mockResolvedValue({user: principal});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  seedPrivateState();
  await seedBearerState();
  if (!success) fake.logout.mockRejectedValue(new Error('offline'));
  await act(async () => {
    if (success) await hook.result.current.logout();
    else await expect(hook.result.current.logout()).rejects.toThrow('offline');
  });
  expect(hook.result.current.status).toBe(success ? 'anonymous' : 'authenticated');
  expect(privateKeys().every(key => !client.getQueryState(key))).toBe(success);
  expectBearerRetained();
  expect(fake.navigate).toHaveBeenCalledTimes(success ? 1 : 0);
});

it('does not let a delayed bootstrap replace a principal established by login', async () => {
  let resolve!: (value: {user: ProfileUserRead}) => void;
  fake.profile.mockImplementation(() => new Promise(done => {resolve = done;}));
  fake.login.mockResolvedValue({...principal, id: 2});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await act(async () => hook.result.current.signIn('b@example.com', 'password'));
  await act(async () => resolve({user: principal}));
  expect(hook.result.current.principal?.id).toBe(2);
});

it('does not restore a cleared principal from an earlier in-flight refresh', async () => {
  fake.profile.mockResolvedValue({user: principal});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  let resolve!: (value: {user: ProfileUserRead}) => void;
  fake.profile.mockImplementation(() => new Promise(done => {resolve = done;}));
  let pending!: Promise<boolean | undefined>;
  act(() => {pending = hook.result.current.refreshPrincipal(); hook.result.current.clearPrincipal();});
  await act(async () => {resolve({user: principal}); await pending;});
  expect(hook.result.current.status).toBe('anonymous');
  expect(hook.result.current.principal).toBeNull();
});

it('removes sensitive bootstrap state on anonymous discovery and retains bearer data', async () => {
  seedPrivateState();
  await seedBearerState();
  fake.profile.mockRejectedValue(anonymous());
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.status).toBe('anonymous'));
  expect(privateKeys().every(key => !client.getQueryState(key))).toBe(true);
  expectBearerRetained();
});

it('removes A private state before establishing B and retains bearer data', async () => {
  fake.profile.mockResolvedValue({user: principal});
  const hook = renderHook(() => useAuthentication(), {wrapper});
  await waitFor(() => expect(hook.result.current.principal?.id).toBe(1));
  seedPrivateState();
  await seedBearerState();
  const next = {...principal, id: 2, email: 'b@example.com'};
  fake.login.mockResolvedValue(next);
  await act(async () => hook.result.current.signIn(next.email, 'password'));
  expect(hook.result.current.principal).toEqual(next);
  expect(privateKeys().every(key => !client.getQueryState(key))).toBe(true);
  expectBearerRetained();
});
