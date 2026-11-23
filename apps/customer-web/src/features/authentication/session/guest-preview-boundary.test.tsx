// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GuestPreviewRead, ProfileRead } from '@/generated/api';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { GuestPreviewPage } from '@/features/scores/guest-preview/public-page';
import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
import { AuthenticationProvider, useAuthentication } from './authentication-context';
import guestPreview from '@/../messages/en/guestPreview.json';

const fake = vi.hoisted(() => ({profile: vi.fn(), read: vi.fn()}));
vi.mock('@/features/account/profile/api', () => ({profileApi: {getProfile: fake.profile}}));
vi.mock('@/features/scores/guest-preview/api', () => ({guestPreviewApi: {read: fake.read}}));
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: {href: string; children: React.ReactNode}) => <a href={href}>{children}</a>}));
let client: QueryClient;
beforeEach(() => {vi.resetAllMocks();client = new QueryClient({defaultOptions: {queries: {retry: false}}});});
afterEach(() => client.clear());
function AuthenticationStatus() {
  return <output data-testid="authentication-status">{useAuthentication().status}</output>;
}

it.each(['anonymous', 'authenticated'] as const)('keeps the active bearer request through bootstrap becoming %s', async status => {
  let finishProfile!: (profile: ProfileRead) => void;
  let rejectProfile!: (error: Error) => void;
  fake.profile.mockReturnValue(new Promise<ProfileRead>((resolve, reject) => {finishProfile = resolve;rejectProfile = reject;}));
  let finishPreview!: (preview: GuestPreviewRead) => void;
  let previewSignal!: AbortSignal;
  fake.read.mockImplementation((_token: string, signal: AbortSignal) => {
    previewSignal = signal;
    return new Promise<GuestPreviewRead>((resolve, reject) => {
      finishPreview = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    });
  });
  const privateKey = ['private-projection'];
  client.setQueryData(privateKey, {principal: 'A'});
  render(<QueryClientProvider client={client}><AuthenticationProvider>
    <NextIntlClientProvider locale="en" messages={{guestPreview}}>
      <AuthenticationStatus /><GuestPreviewPage token="bearer" />
    </NextIntlClientProvider>
  </AuthenticationProvider></QueryClientProvider>);
  await waitFor(() => expect(fake.read).toHaveBeenCalledOnce());
  await waitFor(() => expect(fake.profile).toHaveBeenCalledOnce());
  expect(screen.getByTestId('authentication-status')).toHaveTextContent('bootstrapping');
  expect(screen.getByText(guestPreview.loading)).toBeVisible();
  const bearerKey = guestPreviewQueryKeys.public('bearer');
  const activeQuery = client.getQueryCache().find({queryKey: bearerKey});
  expect(activeQuery?.state.fetchStatus).toBe('fetching');
  await act(async () => {
    if (status === 'anonymous') rejectProfile(new ApiError(401, 'token_invalid_expired'));
    else finishProfile({user: {id: 1, email: 'owner@example.com', display_name: 'Owner', is_active: true}});
  });
  await waitFor(() => expect(screen.getByTestId('authentication-status')).toHaveTextContent(status));
  expect(client.getQueryState(privateKey)).toBeUndefined();
  expect(previewSignal.aborted).toBe(false);
  expect(client.getQueryCache().find({queryKey: bearerKey})).toBe(activeQuery);
  expect(activeQuery?.state.fetchStatus).toBe('fetching');
  const preview: GuestPreviewRead = {display_title: 'Guest Score', shared_by: 'Owner', audio_available: false, render_assets: []};
  await act(async () => finishPreview(preview));
  expect(await screen.findByRole('heading', {name: 'Guest Score'})).toBeVisible();
  expect(client.getQueryData(bearerKey)).toEqual(preview);
  expect(fake.read).toHaveBeenCalledOnce();
});
