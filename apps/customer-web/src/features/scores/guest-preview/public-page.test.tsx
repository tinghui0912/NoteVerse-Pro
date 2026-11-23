// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { GuestPreviewPage } from './public-page';
import { guestPreviewApi } from './api';
import guestPreview from '@/../messages/en/guestPreview.json';
const query = vi.hoisted(() => ({read: vi.fn()}));
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: {href: string; children: React.ReactNode}) => <a href={href}>{children}</a>}));
vi.mock('./queries', () => ({useGuestPreview: query.read}));
const wrapper = ({children}: {children: React.ReactNode}) => <NextIntlClientProvider locale="en" messages={{guestPreview}}>{children}</NextIntlClientProvider>;
beforeEach(() => vi.resetAllMocks());
it('presents current Score images and listening audio from the bearer resource', () => {
  query.read.mockReturnValue({data: {display_title: 'Etude', shared_by: 'Owner', audio_available: true, render_assets: [{asset_id: 'page', page_number: 1}]}, isLoading: false});
  render(<GuestPreviewPage token="bearer" />, {wrapper});
  expect(screen.getByRole('heading', {name: 'Etude'})).toBeVisible();
  expect(screen.getByRole('img', {name: guestPreview.page.replace('{number}', '1')})).toHaveAttribute('src', guestPreviewApi.pageUrl('bearer', 'page'));
  const audio = screen.getByLabelText(guestPreview.audio);
  expect(audio).toHaveAttribute('src', guestPreviewApi.playbackUrl('bearer'));
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
