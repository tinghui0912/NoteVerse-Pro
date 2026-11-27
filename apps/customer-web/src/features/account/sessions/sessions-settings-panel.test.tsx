// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@/generated/api';
import { SessionsSettingsPanel } from './sessions-settings-panel';

const fake = vi.hoisted(() => ({api: {getSessions: vi.fn(), revokeSession: vi.fn(), revokeOtherSessions: vi.fn()}, toast: vi.fn()}));
vi.mock('./api', () => ({accountSessionsApi: fake.api}));
vi.mock('@/hooks/use-toast', () => ({useToast: () => ({toast: fake.toast})}));
vi.mock('next-intl', () => ({useLocale: () => 'en', useTranslations: () => (key: string) => key}));
vi.mock('@/i18n/routing', () => ({routing: {defaultLocale: 'en'}, Link: ({children}: PropsWithChildren) => <>{children}</>}));
const current: SessionSummary = {id: 1, is_current: true, user_agent: 'Chrome', created_at: '2026-11-22T00:00:00Z', expires_at: '2026-12-22T00:00:00Z'};
const other: SessionSummary = {...current, id: 2, is_current: false, user_agent: 'Safari'};
let client: QueryClient;
beforeEach(() => {vi.resetAllMocks(); client = new QueryClient({defaultOptions: {queries: {retry: false}}});});
afterEach(() => client.clear());
const wrapper = ({children}: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it.each(['one', 'others'] as const)('keeps the current row protected and revokes %s through Sessions', async (kind) => {
  fake.api.getSessions.mockResolvedValue({sessions: [current, other]});
  const method = kind === 'one' ? fake.api.revokeSession : fake.api.revokeOtherSessions;
  method.mockImplementation(async () => {fake.api.getSessions.mockResolvedValue({sessions: [current]});});
  render(<SessionsSettingsPanel />, {wrapper});
  expect(await screen.findByRole('button', {name: 'sessions.currentAction'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button', {name: kind === 'one' ? 'sessions.revoke' : 'sessions.revokeOthers'}));
  await waitFor(() => expect(screen.queryByText('Safari')).not.toBeInTheDocument());
  if (kind === 'one') expect(method).toHaveBeenCalledWith(2);
  else expect(method).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', {name: 'sessions.currentAction'})).toBeDisabled();
});

it.each(['empty', 'loading', 'error'] as const)('presents the %s Sessions state', async (state) => {
  if (state === 'empty') fake.api.getSessions.mockResolvedValue({sessions: []});
  if (state === 'loading') fake.api.getSessions.mockImplementation(() => new Promise(() => {}));
  if (state === 'error') fake.api.getSessions.mockRejectedValue(new Error('unavailable'));
  render(<SessionsSettingsPanel />, {wrapper});
  expect(await screen.findByText(state === 'empty' ? 'sessions.empty' : state === 'loading' ? 'sessions.loading' : 'sessions.loadFailed')).toBeVisible();
  expect(screen.getByRole('button', {name: 'sessions.revokeOthers'})).toBeDisabled();
});
