// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/navigation/nav-actions';
import common from '@/../messages/en/common.json';
const fake = vi.hoisted(() => ({logout: vi.fn()}));
beforeEach(() => vi.clearAllMocks());
vi.mock('@/features/authentication/session/authentication-context', () => ({useAuthentication: () => ({principal: {display_name: 'Listener', email: 'listener@example.com'}, logout: fake.logout})}));
vi.mock('@/i18n/routing', () => ({routing: {locales: ['en', 'zh']}, Link: ({href, children, ...props}: PropsWithChildren<{href: string}>) => <a href={href} {...props}>{children}</a>}));
it('presents the current principal and routes Settings and Logout actions', async () => {
  render(<NextIntlClientProvider locale="en" messages={{common}}><UserMenu /></NextIntlClientProvider>);
  expect(screen.getByRole('img', {name: common.accountAvatar})).toBeVisible();
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Listener')).toBeVisible();
  expect(screen.getByText('listener@example.com')).toBeVisible();
  expect(screen.getByRole('menuitem', {name: common.settings})).toHaveAttribute('href', '/settings/profile');
  await userEvent.click(screen.getByRole('menuitem', {name: common.logout}));
  expect(fake.logout).toHaveBeenCalledOnce();
});
