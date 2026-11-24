// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import settings from '@/../messages/en/settings.json';
import errors from '@/../messages/en/errors.json';
import { DeleteAccountForm } from './delete-account-form';

const fake = vi.hoisted(() => ({deleteAccount: vi.fn(),clear: vi.fn(),replace: vi.fn()}));
vi.mock('./api', () => ({accountSecurityApi: {deleteAccount: fake.deleteAccount}}));
vi.mock('@/features/authentication/session/authentication-context', () => ({useAuthentication: () => ({clearPrincipal: fake.clear})}));
vi.mock('@/i18n/routing', () => ({useRouter: () => ({replace: fake.replace})}));
beforeEach(() => vi.resetAllMocks());
function form() {render(<QueryClientProvider client={new QueryClient()}><NextIntlClientProvider locale="en" messages={{settings,errors}}><DeleteAccountForm /></NextIntlClientProvider></QueryClientProvider>);}
async function confirm() {
  await userEvent.type(screen.getByLabelText('Current password'), 'secret123');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', {name:'Delete my account'}));
}
it('requires explicit confirmation and clears the principal only after accepted deletion',async () => {
  fake.deleteAccount.mockResolvedValue({operation_id:'erase'});form();
  expect(screen.getByRole('button',{name:'Delete my account'})).toBeDisabled();
  await confirm();
  await waitFor(() => expect(fake.deleteAccount).toHaveBeenCalledWith('secret123'));
  expect(fake.clear).toHaveBeenCalledOnce();
  expect(fake.replace).toHaveBeenCalledWith('/');
});
it('keeps the account signed in after a rejected password',async () => {
  fake.deleteAccount.mockRejectedValue({code:'current_password_wrong'});form();await confirm();
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(fake.clear).not.toHaveBeenCalled();
  expect(fake.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Delete my account'})).toBeEnabled();
});
