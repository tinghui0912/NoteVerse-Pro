import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { GuestPreviewPage } from './public-page';
import { guestPreviewApi } from './api';
import guestPreview from '@/../messages/en/guestPreview.json';
const query = vi.hoisted(() => ({read: vi.fn()}));
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: {href: string; children: React.ReactNode}) => <a href={href}>{children}</a>}));
vi.mock('./queries', () => ({useGuestPreview: query.read}));
vi.mock('./api', async importOriginal => {const original=await importOriginal<typeof import('./api')>();return {...original, guestPreviewApi: {...original.guestPreviewApi, playbackAccess: vi.fn()}};});
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={new QueryClient()}><NextIntlClientProvider locale="en" messages={{guestPreview}}>{children}</NextIntlClientProvider></QueryClientProvider>;
beforeEach(() => {vi.resetAllMocks();vi.mocked(guestPreviewApi.playbackAccess).mockResolvedValue({playback_url:'https://storage.test/listen',download_url:'https://storage.test/download',expires_in:300});});
it('presents current Score images and listening audio from the bearer resource', async () => {
  query.read.mockReturnValue({data: {display_title: 'Etude', shared_by: 'Owner', audio_available: true, render_assets: [{asset_id: 'page', page_number: 1}]}, isLoading: false});
  render(<GuestPreviewPage token="bearer" />, {wrapper});
  expect(screen.getByRole('heading', {name: 'Etude'})).toBeVisible();
  expect(screen.getByRole('img', {name: guestPreview.page.replace('{number}', '1')})).toHaveAttribute('src', guestPreviewApi.pageUrl('bearer', 'page'));
  const audio = await screen.findByLabelText(guestPreview.audio);
  await waitFor(() => expect(audio).toHaveAttribute('src', 'https://storage.test/listen'));
  expect(audio).toHaveAttribute('controls');
  expect(audio).toHaveAttribute('controlslist', 'nodownload');
});
it('presents loading while the current preview is being read', () => {
  query.read.mockReturnValue({isLoading: true});render(<GuestPreviewPage token="bearer" />, {wrapper});
  expect(screen.getByText(guestPreview.loading)).toBeVisible();
});
it('presents an unavailable preview after a rejected bearer read', () => {
  query.read.mockReturnValue({error: new Error('unavailable'), isLoading: false});render(<GuestPreviewPage token="bearer" />, {wrapper});
  expect(screen.getByText(guestPreview.unavailable)).toBeVisible();
});
