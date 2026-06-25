import { describe, expect, it, vi } from 'vitest';
import { redirect } from '@/i18n/routing';

vi.mock('@/i18n/routing', () => ({
  redirect: vi.fn(),
}));

describe('legacy history route', () => {
  it('redirects to library with the current locale', async () => {
    const { default: HistoryPage } = await import('@/app/[locale]/history/page');

    await HistoryPage({ params: Promise.resolve({ locale: 'zh' }) });

    expect(redirect).toHaveBeenCalledWith({ href: '/library', locale: 'zh' });
  });
});
