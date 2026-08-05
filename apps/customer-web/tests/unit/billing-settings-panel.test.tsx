// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingSettingsPanel } from '@/components/settings/billing-settings-panel';
import zhSettings from '@/../messages/zh/settings.json';

const useStorageUsageMock = vi.fn();

vi.mock('@/hooks/queries/use-storage-usage-query', () => ({
  useStorageUsage: () => useStorageUsageMock(),
}));

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function renderPanel(children: ReactNode = <BillingSettingsPanel />) {
  return render(
    <NextIntlClientProvider locale="zh" messages={{ settings: zhSettings }}>
      {children}
    </NextIntlClientProvider>
  );
}

describe('BillingSettingsPanel', () => {
  beforeEach(() => {
    useStorageUsageMock.mockReset();
  });

  it('renders quota totals and category cards', () => {
    useStorageUsageMock.mockReturnValue({
      data: {
        data: {
          quota: {
            used_bytes: 800,
            reserved_bytes: 100,
            limit_bytes: 1000,
            available_bytes: 100,
          },
          breakdown: [],
        },
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    renderPanel();

    expect(screen.getByText('900 B / 1,000 B')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('已使用')).toBeInTheDocument();
    expect(screen.getByText('800 B')).toBeInTheDocument();
    expect(screen.getByText('处理中')).toBeInTheDocument();
    expect(screen.getAllByText('100 B')).toHaveLength(2);
    expect(screen.getByText('可用')).toBeInTheDocument();
    expect(screen.getByText('存储空间即将用尽，请删除不需要的内容或升级方案。')).toBeInTheDocument();
  });

  it('calls refetch from the refresh button', async () => {
    const refetch = vi.fn();
    useStorageUsageMock.mockReturnValue({
      data: {
        data: {
          quota: {
            used_bytes: 10,
            reserved_bytes: 0,
            limit_bytes: 1000,
            available_bytes: 990,
          },
          breakdown: [],
        },
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch,
    });

    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('disables refresh while fetching and shows the load failure state', () => {
    useStorageUsageMock.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    renderPanel();

    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
    expect(screen.getByText('无法加载存储用量')).toBeInTheDocument();
    expect(screen.getByText('请稍后重试，或刷新页面。')).toBeInTheDocument();
  });
});
