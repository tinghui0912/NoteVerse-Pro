// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountProfileGetResponse } from '@/generated/api';
import { AuthenticationProvider, useAuthentication } from '@/features/authentication/session/authentication-context';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { accountQueryKeys } from '../query-keys';
import ConfirmEmailChangePage from './confirm-email-change-page';

const fake = vi.hoisted(() => ({token: '', confirm: vi.fn(), profile: vi.fn(), translate: (key: string) => key}));
vi.mock('./api', () => ({accountSecurityApi: {confirmEmailChange: fake.confirm}}));
vi.mock('../profile/api', () => ({profileApi: {getProfile: fake.profile}}));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams(fake.token ? {token: fake.token} : {})}));
vi.mock('next-intl', () => ({useTranslations: () => fake.translate}));
vi.mock('@/i18n/routing', () => ({routing: {defaultLocale: 'en'}, Link: ({href, children}: {href: string; children: React.ReactNode}) => <a href={href}>{children}</a>}));

const profile = (email: string): AccountProfileGetResponse => ({user: {
  id: 1, email, display_name: 'User', avatar_url: null, is_active: true, created_at: '2026-11-22T00:00:00Z',
}});
let client: QueryClient;
let sequence = 0;
beforeEach(() => {
  vi.clearAllMocks();
  fake.confirm.mockReset(); fake.profile.mockReset();
  fake.token = `confirmation-${++sequence}`;
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  client.setQueryData(accountQueryKeys.security(), {security: {email: 'old@example.com', email_verified_at: null}});
  client.setQueryData(accountQueryKeys.sessions(), {sessions: []});
});
afterEach(() => client.clear());
function Principal() {
  const {principal, isLoading} = useAuthentication();
  return <output aria-label="principal">{isLoading ? 'bootstrapping' : principal?.email ?? 'anonymous'}</output>;
}
function Wrapper({children}: PropsWithChildren) {
  return <StrictMode><QueryClientProvider client={client}><AuthenticationProvider><Principal />{children}</AuthenticationProvider></QueryClientProvider></StrictMode>;
}

it.each(['authenticated', 'anonymous', 'refresh-failure'] as const)('confirms once and preserves success for %s', async (mode) => {
  let complete!: () => void;
  fake.confirm.mockImplementation(() => new Promise<void>(resolve => {complete = resolve;}));
  if (mode === 'anonymous') fake.profile.mockRejectedValue(new ApiError(401, 'unauthorized', 'unauthorized'));
  else fake.profile.mockResolvedValue(profile('old@example.com'));
  const view = render(<ConfirmEmailChangePage />, {wrapper: Wrapper});
  await waitFor(() => expect(screen.getByLabelText('principal')).toHaveTextContent(mode === 'anonymous' ? 'anonymous' : 'old@example.com'));
  client.setQueryData(accountQueryKeys.security(), {security: {email: 'old@example.com'}});
  client.setQueryData(accountQueryKeys.sessions(), {sessions: []});
  const bootstrapReads = fake.profile.mock.calls.length;
  if (mode === 'authenticated') fake.profile.mockResolvedValue(profile('new@example.com'));
  if (mode === 'refresh-failure') fake.profile.mockRejectedValue(new Error('transient profile failure'));
  await waitFor(() => expect(fake.confirm).toHaveBeenCalledOnce());
  await act(async () => complete());
  expect(await screen.findByRole('heading', {name: 'emailChangeConfirmedTitle'})).toBeVisible();
  expect(fake.profile.mock.calls.length).toBeGreaterThan(bootstrapReads);
  expect(screen.getByLabelText('principal')).toHaveTextContent(mode === 'authenticated' ? 'new@example.com' : mode === 'anonymous' ? 'anonymous' : 'old@example.com');
  if (mode === 'anonymous') {
    expect(client.getQueryState(accountQueryKeys.security())).toBeUndefined();
    expect(client.getQueryState(accountQueryKeys.sessions())).toBeUndefined();
  } else {
    expect(client.getQueryState(accountQueryKeys.security())?.isInvalidated).toBe(true);
    expect(client.getQueryState(accountQueryKeys.sessions())?.isInvalidated).toBe(false);
  }
  view.rerender(<ConfirmEmailChangePage />);
  expect(fake.confirm).toHaveBeenCalledOnce();
  expect(fake.confirm).toHaveBeenCalledWith(fake.token);
  view.unmount();
  render(<ConfirmEmailChangePage />, {wrapper: Wrapper});
  expect(await screen.findByRole('heading', {name: 'emailChangeConfirmedTitle'})).toBeVisible();
  expect(fake.confirm).toHaveBeenCalledOnce();
});

it('rejects a missing token locally without submitting a confirmation', async () => {
  fake.token = '';
  fake.profile.mockRejectedValue(new ApiError(401, 'unauthorized', 'unauthorized'));
  render(<ConfirmEmailChangePage />, {wrapper: Wrapper});
  expect(screen.getByRole('heading', {name: 'emailChangeFailedTitle'})).toBeVisible();
  expect(screen.getByText('emailChangeLinkInvalid')).toBeVisible();
  expect(fake.confirm).not.toHaveBeenCalled();
});

it('refreshes the confirmed principal after the initial profile bootstrap settles', async () => {
  let finishBootstrap!: (value: AccountProfileGetResponse) => void;
  const bootstrap = new Promise<AccountProfileGetResponse>(resolve => {finishBootstrap = resolve;});
  fake.profile.mockReturnValue(bootstrap);
  fake.confirm.mockResolvedValue(undefined);
  render(<ConfirmEmailChangePage />, {wrapper: Wrapper});
  expect(screen.getByLabelText('principal')).toHaveTextContent('bootstrapping');
  expect(fake.confirm).not.toHaveBeenCalled();
  fake.profile.mockResolvedValue(profile('new@example.com'));
  await act(async () => finishBootstrap(profile('old@example.com')));
  expect(await screen.findByRole('heading', {name: 'emailChangeConfirmedTitle'})).toBeVisible();
  expect(screen.getByLabelText('principal')).toHaveTextContent('new@example.com');
  expect(fake.confirm).toHaveBeenCalledOnce();
});

it('shows invalid/expired confirmation failure without changing Account projections', async () => {
  fake.profile.mockResolvedValue(profile('old@example.com'));
  fake.confirm.mockRejectedValue(new ApiError(400, 'token_invalid_expired', 'invalid token'));
  render(<ConfirmEmailChangePage />, {wrapper: Wrapper});
  expect(await screen.findByRole('heading', {name: 'emailChangeFailedTitle'})).toBeVisible();
  expect(screen.getByText('emailChangeLinkInvalid')).toBeVisible();
  expect(client.getQueryState(accountQueryKeys.security())?.isInvalidated ?? false).toBe(false);
  expect(fake.confirm).toHaveBeenCalledOnce();
});
