// @vitest-environment jsdom
import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import { StrictMode, type PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProfileUserRead } from '@/generated/api';
import { AuthenticationProvider, useAuthentication } from './session/authentication-context';
import { RealtimeProvider } from '@/components/providers/realtime-provider';
import LoginPage from './login/login-page';
import RegisterPage from './registration/register-page';
import VerifyEmailPage from './registration/verify-email-page';
import ForgotPasswordPage from './recovery/forgot-password-page';
import ResetPasswordPage from './recovery/reset-password-page';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { libraryQueryKeys } from '@/features/library/query-keys';
import { notificationQueryKeys } from '@/features/notifications/query-keys';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
import { scoreQueryKeys } from '@/features/scores/core/query-keys';
import { accountQueryKeys } from '@/features/account/query-keys';
import { queryKeys } from '@/lib/query-client';

const fake = vi.hoisted(() => ({
  params: '', locale: 'en', profile: vi.fn(), push: vi.fn(), replace: vi.fn(),
  translate: (key: string) => key,
  api: {login: vi.fn(), logout: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn()},
  createSource: vi.fn(), source: {addEventListener: vi.fn(), close: vi.fn()},
}));
vi.mock('./api', () => ({authenticationApi: fake.api}));
vi.mock('@/features/account/profile/api', () => ({profileApi: {getProfile: fake.profile}}));
vi.mock('next/navigation', () => ({useRouter: () => fake, useSearchParams: () => new URLSearchParams(fake.params)}));
vi.mock('next-intl', () => ({useLocale: () => fake.locale, useTranslations: () => fake.translate}));
vi.mock('@/i18n/routing', () => ({routing: {defaultLocale: 'en'}, Link: ({href, children}: PropsWithChildren<{href: string}>) => <a href={href}>{children}</a>}));
vi.mock('@/lib/realtime/event-source', () => ({createRealtimeEventSource: fake.createSource}));
const principal: ProfileUserRead = {id: 1, email: 'a@example.com', display_name: 'A', is_active: true};
let client: QueryClient;
let tokenSequence = 0;
beforeEach(() => {
  vi.resetAllMocks(); fake.locale = 'en'; fake.params = '';
  fake.profile.mockRejectedValue(new ApiError(401, 'token_invalid_expired'));
  fake.api.verifyEmail.mockResolvedValue(undefined);
  fake.createSource.mockReturnValue(fake.source);
  client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
});
afterEach(() => client.clear());
function Principal() {const auth = useAuthentication(); return <output aria-label="session">{auth.status}:{auth.principal?.email}</output>;}
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}><AuthenticationProvider><RealtimeProvider><Principal />{children}</RealtimeProvider></AuthenticationProvider></QueryClientProvider>;

it.each(['/invite/token?accept=1', 'https://evil.example', '/' + String.fromCharCode(92) + 'evil.example'])('logs in from a principal body and follows only safe intent %s', async (returnUrl) => {
  fake.params = new URLSearchParams({returnUrl}).toString();
  fake.api.login.mockResolvedValue(principal);
  render(<LoginPage />, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('session')).toHaveTextContent('anonymous'));
  await userEvent.type(screen.getByLabelText('emailLabel'), 'a@example.com');
  await userEvent.type(screen.getByLabelText('passwordLabel'), 'password');
  await userEvent.click(screen.getByRole('button', {name: 'loginButton'}));
  await waitFor(() => expect(fake.push).toHaveBeenCalledWith(returnUrl.startsWith('/invite') ? returnUrl : '/library'));
  expect(screen.getByLabelText('session')).toHaveTextContent('authenticated:a@example.com');
  expect(fake.profile).toHaveBeenCalledOnce();
  expect(fake.api.login).toHaveBeenCalledWith('a@example.com', 'password');
  expect(fake.createSource).toHaveBeenCalledOnce();
});

it('shows a localized login business failure without establishing a session or navigating', async () => {
  fake.api.login.mockRejectedValue(new ApiError(401, 'invalid_credentials', 'request-id'));
  render(<LoginPage />, {wrapper});
  await userEvent.type(screen.getByLabelText('emailLabel'), 'a@example.com');
  await userEvent.type(screen.getByLabelText('passwordLabel'), 'wrong');
  await userEvent.click(screen.getByRole('button', {name: 'loginButton'}));
  expect(await screen.findByText('invalid_credentials')).toBeVisible();
  expect(fake.push).not.toHaveBeenCalled();
  expect(screen.getByLabelText('session')).toHaveTextContent('anonymous');
  expect(fake.createSource).not.toHaveBeenCalled();
});

it('initiates registration with locale/name fallback and waits for verification without authenticating', async () => {
  render(<RegisterPage />, {wrapper});
  await userEvent.type(screen.getByLabelText('emailLabel'), 'member@example.com');
  await userEvent.type(screen.getByLabelText('passwordLabel'), 'password');
  fireEvent.submit(screen.getByLabelText('emailLabel').closest('form')!);
  expect(await screen.findByRole('heading', {name: 'verifyEmailSentTitle'})).toBeVisible();
  expect(fake.api.register).toHaveBeenCalledWith({email: 'member@example.com', password: 'password', display_name: 'member', locale: 'en'});
  expect(screen.getByLabelText('session')).toHaveTextContent('anonymous');
});

it('verifies the current token once across StrictMode/remounts and still requires login', async () => {
  fake.params = `token=verification-${++tokenSequence}`;
  const view = render(<StrictMode><VerifyEmailPage /></StrictMode>, {wrapper});
  expect(await screen.findByRole('heading', {name: 'emailVerifiedTitle'})).toBeVisible();
  view.unmount();
  render(<VerifyEmailPage />, {wrapper});
  expect(await screen.findByRole('heading', {name: 'emailVerifiedTitle'})).toBeVisible();
  expect(fake.api.verifyEmail).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', {name: 'loginButton'})).toHaveAttribute('href', '/auth/login');
  expect(screen.getByLabelText('session')).toHaveTextContent('anonymous');
});

it.each(['known@example.com', 'unknown@example.com'])('projects the same recovery success for %s', async (email) => {
  render(<ForgotPasswordPage />, {wrapper});
  await userEvent.type(screen.getByLabelText('emailLabel'), email);
  fireEvent.submit(screen.getByLabelText('emailLabel').closest('form')!);
  expect(await screen.findByRole('heading', {name: 'resetEmailSentTitle'})).toBeVisible();
  expect(fake.api.requestPasswordReset).toHaveBeenCalledWith(email, 'en');
  expect(screen.getByLabelText('session')).toHaveTextContent('anonymous');
});

it.each([true, false])('clears principal/private server state after password reset (authenticated=%s)', async (authenticated) => {
  fake.params = 'token=reset-token';
  if (authenticated) fake.profile.mockResolvedValue({user: principal});
  const view = render(<ResetPasswordPage />, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('session')).toHaveTextContent(authenticated ? 'authenticated' : 'anonymous'));
  const privateKeys = [libraryQueryKeys.folders(), notificationQueryKeys.list(), collaborationQueryKeys.myInvites(), scoreQueryKeys.detail('score'), accountQueryKeys.security(), accountQueryKeys.sessions(), storageUsageQueryKeys.current(), queryKeys.performanceTakes.list()];
  for (const key of privateKeys) client.setQueryData(key, {private: 'A'});
  await userEvent.type(screen.getByLabelText('newPasswordLabel'), 'new-password');
  await userEvent.type(screen.getByLabelText('confirmPasswordLabel'), 'new-password');
  fireEvent.submit(screen.getByLabelText('newPasswordLabel').closest('form')!);
  await waitFor(() => expect(fake.push).toHaveBeenCalledWith('/auth/login?reset=success'));
  expect(fake.api.resetPassword).toHaveBeenCalledWith('new-password', 'reset-token', 'en');
  expect(screen.getByLabelText('session')).toHaveTextContent('anonymous');
  expect(privateKeys.every(key => !client.getQueryState(key))).toBe(true);
  if (authenticated) expect(fake.source.close).toHaveBeenCalledOnce();
  view.rerender(<LoginPage />);
  await act(async () => undefined);
  expect(fake.replace).not.toHaveBeenCalledWith('/library');
});

it('does not submit a missing reset token', () => {
  render(<ResetPasswordPage />, {wrapper});
  expect(screen.getByText('resetLinkInvalid')).toBeVisible();
  expect(fake.api.resetPassword).not.toHaveBeenCalled();
});

it.each(['short', 'mismatch'] as const)('rejects %s reset input locally', async (kind) => {
  fake.params = 'token=reset-token';
  render(<ResetPasswordPage />, {wrapper});
  await userEvent.type(screen.getByLabelText('newPasswordLabel'), kind === 'short' ? '12345' : 'password');
  await userEvent.type(screen.getByLabelText('confirmPasswordLabel'), kind === 'short' ? '12345' : 'different');
  fireEvent.submit(screen.getByLabelText('newPasswordLabel').closest('form')!);
  expect(screen.getByText(kind === 'short' ? 'validation.passwordTooShort' : 'validation.passwordsDoNotMatch')).toBeVisible();
  expect(fake.api.resetPassword).not.toHaveBeenCalled();
});

it.each(['missing', 'expired'] as const)('presents %s registration verification without authenticating', async (kind) => {
  if (kind === 'expired') {
    fake.params = `token=expired-${++tokenSequence}`;
    fake.api.verifyEmail.mockRejectedValue(new ApiError(400, 'token_invalid_expired'));
  }
  render(<VerifyEmailPage />, {wrapper});
  expect(await screen.findByRole('heading', {name: 'verifyEmailFailedTitle'})).toBeVisible();
  expect(screen.getByText('verifyEmailLinkInvalid')).toBeVisible();
  expect(fake.api.verifyEmail).toHaveBeenCalledTimes(kind === 'missing' ? 0 : 1);
  expect(fake.createSource).not.toHaveBeenCalled();
});
