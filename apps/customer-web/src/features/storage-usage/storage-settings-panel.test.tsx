// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import enSettings from '@/../messages/en/settings.json';
import zhSettings from '@/../messages/zh/settings.json';
import { StorageSettingsPanel } from './storage-settings-panel';

const fake = vi.hoisted(() => ({query: vi.fn(), refetch: vi.fn()}));
vi.mock('./queries', () => ({useStorageUsage: fake.query}));
const quota = (limit: number | null = 1000, used = 800, reserved = 100, available: number | null = 100) => ({
  data: {quota: {limit_bytes: limit, used_bytes: used, reserved_bytes: reserved, available_bytes: available}, breakdown: []},
  isError: false, isFetching: false, isLoading: false, refetch: fake.refetch,
});
beforeEach(() => {vi.resetAllMocks(); fake.query.mockReturnValue(quota());});
function panel(locale: 'en' | 'zh' = 'en') {
  return render(<NextIntlClientProvider locale={locale} messages={{settings: locale === 'en' ? enSettings : zhSettings}}><StorageSettingsPanel /></NextIntlClientProvider>);
}
function metric(label: string) {return within(screen.getByText(label).parentElement!);}
it('shows allocated utilization while used and processing remain separate facts', () => {
  panel();
  expect(screen.getByText('90%')).toBeVisible();
  expect(screen.getByText('900 B / 1,000 B allocated')).toBeVisible();
  expect(metric('Used').getByText('800 B')).toBeVisible();
  expect(metric('Processing').getByText('100 B')).toBeVisible();
  expect(metric('Available').getByText('100 B')).toBeVisible();
  expect(screen.getByText(enSettings.storage.nearLimit)).toBeVisible();
});
it('uses server available bytes even when they differ from a client arithmetic estimate', () => {
  fake.query.mockReturnValue(quota(1000, 800, 100, 37));panel();
  expect(metric('Available').getByText('37 B')).toBeVisible();
});
it.each([[0, 0], [0, 20], [100, 120]])('bounds utilization for limit=%s and used=%s', (limit, used) => {
  fake.query.mockReturnValue(quota(limit, used, 0, 0));panel();
  expect(screen.getByText('100%')).toBeVisible();
  expect(screen.queryByText(/^0%$/)).toBeNull();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByText(limit === 0 ? enSettings.storage.noCapacity : enSettings.storage.full)).toBeVisible();
  expect(metric('Available').getByText('0 B')).toBeVisible();
});
it('offers manual refresh', async () => {
  panel();await userEvent.click(screen.getByRole('button', {name: 'Refresh'}));
  expect(fake.refetch).toHaveBeenCalledOnce();
});
it('disables refresh while fetching', () => {
  fake.query.mockReturnValue({...quota(), isFetching: true});panel();
  expect(screen.getByRole('button', {name: 'Refresh'})).toBeDisabled();
});
it('shows loading without presenting a healthy zero utilization', () => {
  fake.query.mockReturnValue({...quota(), data: undefined, isLoading: true});panel();
  expect(screen.getByRole('status', {name: enSettings.storage.loading})).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
});
it('shows an error and leaves manual retry available', async () => {
  fake.query.mockReturnValue({...quota(), data: undefined, isError: true});panel();
  expect(screen.getByText(enSettings.storage.loadFailed)).toBeVisible();
  await userEvent.click(screen.getByRole('button', {name: 'Refresh'}));expect(fake.refetch).toHaveBeenCalledOnce();
});
it('localizes the zero-capacity state', () => {
  fake.query.mockReturnValue(quota(0, 0, 0, 0));panel('zh');
  expect(screen.getByText(zhSettings.storage.noCapacity)).toBeVisible();
  expect(screen.queryByText(zhSettings.storage.nearLimit)).toBeNull();
});

it('renders unlimited quota without a finite utilization or capacity warning', () => {
  fake.query.mockReturnValue(quota(null, 800, 100, null)); panel();
  expect(screen.getByText('900 B / Unlimited allocated')).toBeVisible();
  expect(metric('Available').getByText('Unlimited')).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText(enSettings.storage.noCapacity)).toBeNull();
});
