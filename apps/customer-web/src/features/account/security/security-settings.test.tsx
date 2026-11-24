// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SecuritySettingsPanel } from './security-settings-panel';
import { PasswordSettingsForm } from './password-settings-form';
import { accountQueryKeys } from '../query-keys';

const fake = vi.hoisted(() => ({locale: 'en', toast: vi.fn(), api: {getSecurityOverview: vi.fn(), requestEmailChange: vi.fn(), changePassword: vi.fn()}}));
vi.mock('./api', () => ({accountSecurityApi: fake.api}));
vi.mock('@/hooks/use-toast', () => ({useToast: () => ({toast: fake.toast})}));
vi.mock('next-intl', () => ({useLocale: () => fake.locale, useTranslations: () => (key: string) => key}));
vi.mock('@/features/authentication/session/authentication-context', () => ({useAuthentication: () => ({clearPrincipal: vi.fn()})}));
vi.mock('@/i18n/routing', () => ({useRouter: () => ({replace: vi.fn()}),routing: {defaultLocale: 'en'}, Link: ({children}: PropsWithChildren) => <>{children}</>}));
let client: QueryClient;
beforeEach(() => { vi.resetAllMocks(); fake.locale = 'en'; client = new QueryClient({defaultOptions: {queries: {retry: false}}}); });
afterEach(() => client.clear());
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it.each([true, false])('presents current email verification=%s and unavailable MFA', async (verified) => {
  fake.api.getSecurityOverview.mockResolvedValue({security: {email: 'old@example.com', email_verified_at: verified ? '2026-11-22T00:00:00Z' : null, mfa_available: false, mfa_enabled: false}});
  render(<SecuritySettingsPanel />, {wrapper});
  expect(await screen.findByText('old@example.com')).toBeVisible();
  expect(screen.getByText(verified ? 'security.verifiedTag' : 'security.notVerified')).toBeVisible();
  expect(screen.getByText('security.comingSoon')).toBeVisible();
});

it('submits email, current password and locale without claiming the email is already changed', async () => {
  const old = {security: {email: 'old@example.com'}};
  fake.api.getSecurityOverview.mockResolvedValue(old);
  render(<SecuritySettingsPanel />, {wrapper});
  await screen.findByText('old@example.com');
  await userEvent.click(screen.getByRole('button', {name: 'security.changeEmail'}));
  await userEvent.type(screen.getByLabelText('security.newEmail'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('currentPassword'), 'current-password');
  await userEvent.click(screen.getByRole('button', {name: 'security.sendEmailChange'}));
  await waitFor(() => expect(fake.api.requestEmailChange).toHaveBeenCalledWith({new_email: 'new@example.com', current_password: 'current-password', locale: 'en'}));
  expect(client.getQueryData(accountQueryKeys.security())).toEqual(old);
  expect(screen.getByText('old@example.com')).toBeVisible();
});

it.each(['mismatch', 'short', 'success'] as const)('handles password %s before projecting an admitted change', async (kind) => {
  client.setQueryData(accountQueryKeys.security(), {});
  client.setQueryData(accountQueryKeys.sessions(), {sessions: []});
  render(<PasswordSettingsForm />, {wrapper});
  const password = kind === 'short' ? '12345' : '123456';
  fireEvent.change(screen.getByLabelText('currentPassword'), {target: {value: 'current-password'}});
  fireEvent.change(screen.getByLabelText('newPassword'), {target: {value: password}});
  fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {target: {value: kind === 'mismatch' ? 'different' : password}});
  await userEvent.click(screen.getByRole('button', {name: 'password.save'}));
  if (kind === 'success') {
    await waitFor(() => expect(fake.api.changePassword).toHaveBeenCalledWith('current-password', '123456', 'en'));
    await waitFor(() => expect(client.getQueryState(accountQueryKeys.sessions())?.isInvalidated).toBe(true));
    expect(client.getQueryState(accountQueryKeys.security())?.isInvalidated).toBe(true);
  } else {
    expect(fake.api.changePassword).not.toHaveBeenCalled();
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({title: kind === 'mismatch' ? 'passwordMismatchTitle' : 'passwordTooShortTitle'}));
    expect(client.getQueryState(accountQueryKeys.security())?.isInvalidated).toBe(false);
  }
});

it.each(['en', 'zh'] as const)('uses %s UI locale for password-change notification admission', async (locale) => {
  fake.locale = locale;
  render(<PasswordSettingsForm />, {wrapper});
  fireEvent.change(screen.getByLabelText('currentPassword'), {target: {value: 'current-password'}});
  fireEvent.change(screen.getByLabelText('newPassword'), {target: {value: '123456'}});
  fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {target: {value: '123456'}});
  fireEvent.submit(screen.getByLabelText('newPassword').closest('form')!);
  await waitFor(() => expect(fake.api.changePassword).toHaveBeenCalledWith('current-password', '123456', locale));
});
