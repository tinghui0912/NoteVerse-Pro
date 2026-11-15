// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScoreGuestPreviewPanel } from './score-guest-preview-panel';
import { GuestPreviewPage } from '@/components/external/guest-preview-page';
import { queryKeys } from '@/lib/query-client';
import guestPreview from '@/../messages/en/guestPreview.json';
import errors from '@/../messages/en/errors.json';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  read: vi.fn(),
  copy: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  guestPreviewApi: {
    getSettings: (...args: unknown[]) => api.getSettings(...args),
    updateSettings: (...args: unknown[]) => api.updateSettings(...args),
    read: (...args: unknown[]) => api.read(...args),
    pageUrl: (token: string, asset: string) =>
      `/guest-previews/${token}/render-assets/${asset}/view`,
    playbackUrl: (token: string) => `/guest-previews/${token}/playback`,
  },
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

it('reloads, toggles and copies the same stable link', async () => {
  let enabled = false;
  const settings = () => ({ enabled, token: 'stable-token' });
  api.getSettings.mockImplementation(async () => settings());
  api.updateSettings.mockImplementation(async (_scoreId, input) => {
    enabled = input.enabled;
    return settings();
  });
  const first = mount(<ScoreGuestPreviewPanel scoreId="score" />);
  const link = await screen.findByRole('textbox', { name: guestPreview.link });
  expect(link).toHaveValue('http://localhost:3000/en/preview/stable-token');
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    guestPreview.enable,
    guestPreview.copy,
  ]);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: guestPreview.enable }));
  expect(await screen.findByRole('button', { name: guestPreview.disable })).toBeEnabled();
  expect(api.updateSettings).toHaveBeenLastCalledWith('score', { enabled: true });
  first.unmount();
  first.client.clear();
  const second = mount(<ScoreGuestPreviewPanel scoreId="score" />);
  expect(await screen.findByRole('textbox', { name: guestPreview.link })).toHaveValue(
    'http://localhost:3000/en/preview/stable-token'
  );
  await userEvent.click(screen.getByRole('button', { name: guestPreview.disable }));
  expect(await screen.findByRole('button', { name: guestPreview.enable })).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('http://localhost:3000/en/preview/stable-token');
  await userEvent.click(screen.getByRole('button', { name: guestPreview.enable }));
  await screen.findByRole('button', { name: guestPreview.disable });
  await userEvent.click(screen.getByRole('button', { name: guestPreview.copy }));
  expect(api.copy).toHaveBeenCalledWith('http://localhost:3000/en/preview/stable-token');
  second.client.clear();
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
      queryKey: queryKeys.scores.guestPreview('stable-token'),
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
