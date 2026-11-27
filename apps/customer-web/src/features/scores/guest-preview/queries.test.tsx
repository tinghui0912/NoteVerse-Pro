// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { clearPrincipalServerState } from '@/features/authentication/cache';
import { useScoreInviteAccess } from '@/features/scores/collaboration/queries';
import { collaborationQueryKeys } from '@/features/scores/collaboration/query-keys';
import { guestPreviewQueryKeys } from './query-keys';
import { useGuestPreview, useGuestPreviewSettings } from './queries';

vi.mock('./api', () => ({guestPreviewApi: {
  read: vi.fn(async () => ({display_title: 'Guest Score'})),
  getSettings: vi.fn(async () => ({enabled: true})),
}}));
vi.mock('@/features/scores/collaboration/api', () => ({collaborationApi: {
  inspectInvite: vi.fn(async () => ({can_accept: true})),
}}));

it('retains only bearer reads while owner settings and optional-user invite inspection follow the principal', async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({
    bearer: useGuestPreview('token'),
    settings: useGuestPreviewSettings('score'),
    invite: useScoreInviteAccess('invite'),
  }), {wrapper});
  await waitFor(() => expect([hook.result.current.bearer.isSuccess, hook.result.current.settings.isSuccess, hook.result.current.invite.isSuccess]).toEqual([true, true, true]));
  hook.unmount();
  clearPrincipalServerState(client);
  expect(client.getQueryData(guestPreviewQueryKeys.public('token'))).toEqual({display_title: 'Guest Score'});
  expect(client.getQueryState(guestPreviewQueryKeys.settings('score'))).toBeUndefined();
  expect(client.getQueryState(collaborationQueryKeys.inviteAccess('invite'))).toBeUndefined();
  client.clear();
});
