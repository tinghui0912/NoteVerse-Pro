// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import RegisterPage from './registration/register-page';
import ResetPasswordPage from './recovery/reset-password-page';
import { PasswordSettingsForm } from '../account/security/password-settings-form';
import en from '../../../messages/en/auth.json';
import zh from '../../../messages/zh/auth.json';

const fake = vi.hoisted(() => ({locale: 'en', register: vi.fn(), reset: vi.fn(), mutate: vi.fn(), toast: vi.fn(), navigate: vi.fn()}));
vi.mock('./api', () => ({authenticationApi: {register: fake.register, resetPassword: fake.reset}}));
vi.mock('./session/authentication-context', () => ({useAuthentication: () => ({isAuthenticated: false, isLoading: false, clearPrincipal: vi.fn()})}));
vi.mock('../account/security/queries', () => ({useChangePassword: () => ({mutate: fake.mutate, isPending: false})}));
vi.mock('@/hooks/use-toast', () => ({useToast: () => ({toast: fake.toast})}));
vi.mock('next/navigation', () => ({useRouter: () => ({push: fake.navigate, replace: fake.navigate}), useSearchParams: () => new URLSearchParams()}));
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: React.PropsWithChildren<{href: string}>) => <a href={href}>{children}</a>}));
vi.mock('next-intl', () => ({useLocale: () => fake.locale, useTranslations: (scope: string) => (key: string) => {
  if (scope !== 'auth') return key;
  const messages = fake.locale === 'en' ? en : zh;
  return key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], messages) as string;
}}));

beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/auth/reset-password#token=credential'); });

const forms = ['register', 'change', 'reset'] as const;
const locales = ['en', 'zh'] as const;
const invalid = [['a'.repeat(11), 'passwordTooShort'], ['a'.repeat(129), 'passwordTooLong'], [' '.repeat(12), 'passwordEmpty']] as const;

function mount(form: typeof forms[number]) {
  return render(form === 'register' ? <RegisterPage /> : form === 'change' ? <PasswordSettingsForm /> : <ResetPasswordPage />);
}

async function submit(form: typeof forms[number], password: string) {
  const input = await waitFor(() => {
    const element = document.getElementById(form === 'change' ? 'new-password' : 'password');
    expect(element).not.toBeNull();
    return element!;
  });
  if (form === 'register') fireEvent.change(document.getElementById('email')!, {target: {value: 'member@example.com'}});
  if (form === 'change') fireEvent.change(document.getElementById('current-password')!, {target: {value: 'current-password'}});
  fireEvent.change(input, {target: {value: password}});
  if (form !== 'register') fireEvent.change(document.getElementById('confirm-password')!, {target: {value: password}});
  fireEvent.submit(input.closest('form')!);
}

for (const locale of locales) for (const form of forms) {
  it.each(invalid)(`${locale} ${form} rejects invalid password %j`, async (password, code) => {
    fake.locale = locale;
    mount(form);
    await submit(form, password);
    const message = (locale === 'en' ? en : zh).validation[code];
    if (form === 'change') expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({description: message}));
    else expect(await screen.findByText(message)).toBeVisible();
    expect(fake.register).not.toHaveBeenCalled();
    expect(fake.reset).not.toHaveBeenCalled();
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it.each([12, 128])(`${locale} ${form} admits %i characters`, async length => {
    fake.locale = locale;
    mount(form);
    const password = 'é'.repeat(length);
    await submit(form, password);
    const command = form === 'register' ? fake.register : form === 'change' ? fake.mutate : fake.reset;
    await waitFor(() => expect(command).toHaveBeenCalledOnce());
    if (form === 'register') expect(fake.register).toHaveBeenCalledWith(expect.objectContaining({password}));
    if (form === 'change') expect(fake.mutate).toHaveBeenCalledWith(expect.objectContaining({newPassword: password}), expect.anything());
    if (form === 'reset') expect(fake.reset).toHaveBeenCalledWith(password, 'credential', locale);
  });
}
