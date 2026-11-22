// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import InvitePage from './invite-page';
import type { InviteAccessRead } from '@/generated/api';

const state = vi.hoisted(() => ({ authenticated: false, email: 'member@example.com', push: vi.fn(), accept: vi.fn(), refetch: vi.fn() }));
const invite: InviteAccessRead = { invite_id: 'invite', score_id: 'score', score_display_title: 'Etude', email: 'member@example.com', role: 'VIEWER', status: 'PENDING', requires_login: true, can_accept: true, expires_at: null, inviter: null };
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => Object.assign((key: string) => key, { has: () => false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('@/i18n/routing', () => ({ Link: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href}>{children}</a> }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated, isLoading: false, user: { email: state.email } }) }));
vi.mock('./queries', () => ({
  useScoreInviteAccess: () => ({ data: invite, isLoading: false, error: null, refetch: state.refetch }),
  useAcceptScoreInvite: () => ({ isPending: false, error: null, mutate: (token: string, callbacks: { onSuccess: (data: { score_id: string }) => void }) => { state.accept(token); callbacks.onSuccess({ score_id: 'score' }); } }),
}));
beforeEach(() => { vi.clearAllMocks(); state.authenticated = false; state.email = 'member@example.com'; window.history.replaceState(null, '', '/invite/token'); });

it('preserves accept intent through the login return location', () => {
  render(<InvitePage token="token" />);
  expect(screen.getByRole('link', { name: 'acceptInvite' })).toHaveAttribute('href', '/auth/login?returnUrl=%2Finvite%2Ftoken%3Faccept%3D1');
  expect(state.accept).not.toHaveBeenCalled();
});

it('accepts after matching login and navigates to the canonical Score', async () => {
  state.authenticated = true;
  window.history.replaceState(null, '', '/invite/token?accept=1');
  render(<InvitePage token="token" />);
  await waitFor(() => expect(state.accept).toHaveBeenCalledExactlyOnceWith('token'));
  expect(state.push).toHaveBeenCalledWith('/score/score');
});

it('keeps a mismatched account from accepting the invitation', () => {
  state.authenticated = true; state.email = 'other@example.com';
  render(<InvitePage token="token" />);
  expect(screen.getByRole('button', { name: 'acceptInvite' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'acceptInvite' }));
  expect(state.accept).not.toHaveBeenCalled();
});
