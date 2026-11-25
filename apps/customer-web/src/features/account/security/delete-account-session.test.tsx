// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import settings from '@/../messages/en/settings.json';
import errors from '@/../messages/en/errors.json';
import { AuthenticationProvider, useAuthentication } from '@/features/authentication/session/authentication-context';
import { accountQueryKeys } from '../query-keys';
import { DeleteAccountForm } from './delete-account-form';
const fake = vi.hoisted(() => ({profile: vi.fn(), deleteAccount: vi.fn(), replace: vi.fn()}));
vi.mock('@/features/account/profile/api', () => ({profileApi: {getProfile: fake.profile}}));
vi.mock('./api', () => ({accountSecurityApi: {deleteAccount: fake.deleteAccount}}));
vi.mock('@/i18n/routing', () => ({useRouter: () => ({replace: fake.replace})}));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  fake.profile.mockResolvedValue({user: {id: 1,email: 'private@example.com',display_name: 'Private',is_active: true,avatar_url: null}});
});
afterEach(() => client.clear());
function Page() {
  const authentication = useAuthentication();
  return <><output aria-label="Current principal">{authentication.principal?.email ?? authentication.status}</output><DeleteAccountForm /></>;
}
async function mount() {
  render(<QueryClientProvider client={client}><AuthenticationProvider><NextIntlClientProvider locale="en" messages={{settings,errors}}><Page /></NextIntlClientProvider></AuthenticationProvider></QueryClientProvider>);
  await screen.findByText('private@example.com');
  client.setQueryData(accountQueryKeys.security(), {email: 'private@example.com'});
}
async function confirm() {
  await userEvent.type(screen.getByLabelText('Current password'), 'secret123');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', {name: 'Delete my account'}));
}
it('keeps the real principal during submission, then clears private state immediately on acceptance', async () => {
  let accept!: (value: {operation_id: string}) => void;
  fake.deleteAccount.mockReturnValue(new Promise(resolve => {accept = resolve;}));
  await mount();
  await confirm();
  expect(screen.getByLabelText('Current principal')).toHaveTextContent('private@example.com');
  expect(client.getQueryData(accountQueryKeys.security())).toBeDefined();
  accept({operation_id: 'accepted-erasure'});
  await waitFor(() => expect(screen.getByLabelText('Current principal')).toHaveTextContent('anonymous'));
  expect(client.getQueryState(accountQueryKeys.security())).toBeUndefined();
  expect(fake.replace).toHaveBeenCalledWith('/');
  expect(fake.deleteAccount).toHaveBeenCalledOnce();
  expect(fake.profile).toHaveBeenCalledOnce();
});
it('retains the real principal and private caches after rejection', async () => {
  fake.deleteAccount.mockRejectedValue(new Error('rejected'));
  await mount(); await confirm();
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Current principal')).toHaveTextContent('private@example.com');
  expect(client.getQueryData(accountQueryKeys.security())).toEqual({email: 'private@example.com'});
  expect(fake.replace).not.toHaveBeenCalled();
});
