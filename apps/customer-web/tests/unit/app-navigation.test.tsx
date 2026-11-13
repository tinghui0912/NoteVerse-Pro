// @vitest-environment jsdom
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import common from '../../messages/en/common.json';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/i18n/routing', () => ({
  usePathname: () => '/library',
  useRouter: () => navigation,
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/navigation', () => ({
  LanguageSwitcher: () => null,
  NotificationBell: () => null,
  UserMenu: () => null,
}));
it('separates workspace destinations from the global creation action', () => {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <AppShell>Workspace</AppShell>
    </NextIntlClientProvider>,
  );
  const nav = screen.getByRole('navigation');
  expect(
    within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href')),
  ).toEqual(['/library', '/my-performances', '/settings/profile']);
  expect(screen.getByRole('link', { name: 'NoteVerse Pro' })).toHaveAttribute(
    'href',
    '/library',
  );
  expect(screen.getByRole('link', { name: common.nav.upload })).toHaveAttribute(
    'href',
    '/upload',
  );
  const search = screen.getByPlaceholderText(common.searchScores);
  fireEvent.change(search, { target: { value: 'Bach' } });
  fireEvent.submit(search.closest('form')!);
  expect(navigation.push).toHaveBeenCalledWith('/library?search=Bach');
});
