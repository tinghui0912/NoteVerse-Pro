import { guestPreviewQueryKeys } from '@/features/scores/guest-preview/query-keys';
// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScoreGuestPreviewPanel } from './owner-panel';
import { GuestPreviewPage } from '@/features/scores/guest-preview/public-page';
import guestPreview from '@/../messages/en/guestPreview.json';
import errors from '@/../messages/en/errors.json';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  issueCredential: vi.fn(),
  revokeCredential: vi.fn(),
  rotateCredential: vi.fn(),
  read: vi.fn(),
  copy: vi.fn(),
}));
vi.mock('@/features/scores/guest-preview/api', () => ({
guestPreviewApi: {
    getSettings: (...args: unknown[]) => api.getSettings(...args),
    issueCredential: (...args: unknown[]) => api.issueCredential(...args),
    revokeCredential: (...args: unknown[]) => api.revokeCredential(...args),
    rotateCredential: (...args: unknown[]) => api.rotateCredential(...args),
    read: (...args: unknown[]) => api.read(...args),
    pageUrl: (token: string, asset: string) =>
      `/guest-previews/${token}/render-assets/${asset}/view`,
    playbackUrl: (token: string) => `/guest-previews/${token}/playback`,
  }
}));
vi.mock('@/i18n/routing', () => ({
  routing: { defaultLocale: 'zh' },
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ guestPreview, errors }}>
          {element}
        </NextIntlClientProvider>
      </QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: api.copy },
  });
  api.copy.mockResolvedValue(undefined);
});

it('reveals a credential once, hides it on reload, rotates and clears it on revoke', async () => {
  let enabled = false;
  const issued_at = '2026-11-17T00:00:00Z';
  const settings = () => ({ enabled, issued_at: enabled ? issued_at : null });
  api.getSettings.mockImplementation(async () => settings());
  api.issueCredential.mockImplementation(async () => { enabled = true; return { token: 'token-a', issued_at }; });
  api.rotateCredential.mockResolvedValue({ token: 'token-b', issued_at });
  api.revokeCredential.mockImplementation(async () => { enabled = false; });
  const first = mount(<ScoreGuestPreviewPanel scoreId="score" />);
  await screen.findByRole('button', { name: guestPreview.enable });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: guestPreview.enable }));
  expect(await screen.findByRole('textbox', { name: guestPreview.link })).toHaveValue('http://localhost:3000/en/preview/token-a');
  expect(screen.getByText(guestPreview.oneTimeReveal)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: guestPreview.copy }));
  expect(api.copy).toHaveBeenCalledWith('http://localhost:3000/en/preview/token-a');
  expect(api.issueCredential).toHaveBeenCalledWith('score');
  expect(first.client.getQueryData(guestPreviewQueryKeys.settings('score'))).toEqual(settings());
  expect(JSON.stringify(first.client.getQueryCache().getAll())).not.toContain('token-a');
  first.unmount(); first.client.clear();
  const second = mount(<ScoreGuestPreviewPanel scoreId="score" />);
  await screen.findByRole('button', { name: guestPreview.rotate });
  expect(screen.getByText(guestPreview.secretHidden)).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: guestPreview.copy })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: guestPreview.rotate }));
  expect(await screen.findByRole('textbox')).toHaveValue('http://localhost:3000/en/preview/token-b');
  expect(api.rotateCredential).toHaveBeenCalledWith('score');
  expect(second.client.getQueryData(guestPreviewQueryKeys.settings('score'))).toEqual(settings());
  await userEvent.click(screen.getByRole('button', { name: guestPreview.disable }));
  await screen.findByRole('button', { name: guestPreview.enable });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: guestPreview.rotate })).not.toBeInTheDocument();
  expect(api.revokeCredential).toHaveBeenCalledWith('score');
  expect(second.client.getQueryData(guestPreviewQueryKeys.settings('score'))).toEqual({ enabled: false, issued_at: null });
  second.client.clear();
});

it('keeps a revealed credential scoped to its Score component context', async () => {
  api.getSettings.mockImplementation(async (id) => ({ enabled: id === 'other', issued_at: id === 'other' ? '2026-11-17T00:00:00Z' : null }));
  api.issueCredential.mockResolvedValue({ token: 'private-score-token', issued_at: '2026-11-17T00:00:00Z' });
  function OwnerContext() {
    const [id, setId] = React.useState('score');
    return <><button onClick={() => setId('other')}>Other score</button><ScoreGuestPreviewPanel scoreId={id} /></>;
  }
  const view = mount(<OwnerContext />);
  await userEvent.click(await screen.findByRole('button', { name: guestPreview.enable }));
  expect(await screen.findByRole('textbox')).toHaveValue('http://localhost:3000/en/preview/private-score-token');
  await userEvent.click(screen.getByRole('button', { name: 'Other score' }));
  await screen.findByRole('button', { name: guestPreview.rotate });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  view.client.clear();
});

it('refreshes current-head pages without changing the bearer token', async () => {
  let page = 'head-a';
  api.read.mockImplementation(async () => ({
      display_title: 'Score',
      shared_by: 'Owner',
      audio_available: true,
      render_assets: [{ asset_id: page, page_number: 1 }],
    }));
  const view = mount(<GuestPreviewPage token="stable-token" />);
  expect(await screen.findByRole('img', { name: 'Score page 1' })).toHaveAttribute(
    'src',
    expect.stringContaining('head-a')
  );
  page = 'head-b';
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: guestPreviewQueryKeys.public('stable-token'),
    });
  });
  await waitFor(() =>
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('head-b'))
  );
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  view.client.clear();
});

it('shows one unavailable presentation when bearer access is disabled', async () => {
  api.read.mockRejectedValue(new Error('unavailable'));
  const view = mount(<GuestPreviewPage token="stable-token" />);
  expect(await screen.findByText(guestPreview.unavailable)).toBeVisible();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  view.client.clear();
});
