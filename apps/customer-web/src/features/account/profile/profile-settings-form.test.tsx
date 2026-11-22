// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountProfileGetResponse } from '@/generated/api';
import { AuthenticationProvider, useAuthentication } from '@/features/authentication/session/authentication-context';
import { ProfileSettingsForm } from './profile-settings-form';

const fake = vi.hoisted(() => ({api: {getProfile: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn()}, toast: vi.fn()}));
vi.mock('./api', () => ({profileApi: fake.api}));
vi.mock('@/hooks/use-toast', () => ({useToast: () => ({toast: fake.toast})}));
vi.mock('next-intl', () => ({useTranslations: () => (key: string) => key}));
vi.mock('./avatar-cropper-modal', () => ({AvatarCropperModal: ({onSave}: {onSave: (file: File) => void}) => <button onClick={() => onSave(new File(['cropped'], 'avatar.png', {type: 'image/png'}))}>Save crop</button>}));
const profile = (name: string): AccountProfileGetResponse => ({user: {id: 1, email: 'user@example.com', display_name: name, avatar_url: '/api/v1/me/avatars/first.jpg', is_active: true, created_at: '2026-11-22T00:00:00Z'}});
let client: QueryClient;
beforeEach(() => {vi.resetAllMocks(); fake.api.getProfile.mockResolvedValue(profile('Original')); client = new QueryClient({defaultOptions: {queries: {retry: false}}});});
afterEach(() => client.clear());
function Principal() {
  const {principal} = useAuthentication();
  return <><output aria-label="principal-name">{principal?.display_name}</output><output aria-label="principal-avatar">{principal?.avatar_url}</output></>;
}
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}><AuthenticationProvider><Principal />{children}</AuthenticationProvider></QueryClientProvider>;

it.each([true, false])('refreshes the principal only after a successful profile write (success=%s)', async (success) => {
  if (success) fake.api.updateProfile.mockImplementation(async () => {fake.api.getProfile.mockResolvedValue(profile('Updated'));});
  else fake.api.updateProfile.mockRejectedValue(new Error('unavailable'));
  render(<ProfileSettingsForm />, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('usernameLabel')).toHaveValue('Original'));
  await userEvent.clear(screen.getByLabelText('usernameLabel'));
  await userEvent.type(screen.getByLabelText('usernameLabel'), 'Updated');
  await userEvent.click(screen.getByRole('button', {name: 'profile.save'}));
  await waitFor(() => expect(fake.api.updateProfile).toHaveBeenCalledWith({display_name: 'Updated'}));
  if (success) await waitFor(() => expect(screen.getByLabelText('principal-name')).toHaveTextContent('Updated'));
  else {
    await waitFor(() => expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({title: 'profileFailed'})));
    expect(screen.getByLabelText('principal-name')).toHaveTextContent('Original');
    expect(fake.api.getProfile).toHaveBeenCalledOnce();
  }
});

it.each([true, false])('updates the avatar immediately only for a successful upload (success=%s)', async (success) => {
  if (success) fake.api.uploadAvatar.mockResolvedValue({avatar_url: '/api/v1/me/avatars/next.jpg', filename: 'next.jpg'});
  else fake.api.uploadAvatar.mockRejectedValue(new Error('unavailable'));
  const view = render(<ProfileSettingsForm />, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('principal-name')).toHaveTextContent('Original'));
  await userEvent.upload(view.container.querySelector<HTMLInputElement>('input[type=file]')!, new File(['image'], 'source.png', {type: 'image/png'}));
  await userEvent.click(await screen.findByRole('button', {name: 'Save crop'}));
  await waitFor(() => expect(fake.api.uploadAvatar).toHaveBeenCalledWith(expect.any(File)));
  if (success) await waitFor(() => expect(screen.getByLabelText('principal-avatar').textContent).toMatch(/^\/api\/v1\/me\/avatars\/next\.jpg\?t=\d+$/));
  else {
    await waitFor(() => expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({title: 'uploadFailed'})));
    expect(screen.getByLabelText('principal-avatar')).toHaveTextContent('/api/v1/me/avatars/first.jpg');
  }
  expect(fake.api.getProfile).toHaveBeenCalledOnce();
});
