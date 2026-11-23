// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/navigation/nav-actions';
import common from '@/../messages/en/common.json';
vi.mock('@/features/authentication/session/authentication-context', () => ({useAuthentication: () => ({principal: {display_name: 'Listener', email: 'listener@example.com'}, logout: vi.fn()})}));
vi.mock('@/i18n/routing', () => ({routing: {locales: ['en', 'zh']}, Link: ({href, children}: PropsWithChildren<{href: string}>) => <a href={href}>{children}</a>}));
it('presents the current principal identity without claiming a paid membership', async () => {
  render(<NextIntlClientProvider locale="en" messages={{common}}><UserMenu /></NextIntlClientProvider>);
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Listener')).toBeVisible();
  expect(screen.getByText('listener@example.com')).toBeVisible();
  expect(screen.queryByText('Premium User')).toBeNull();
});
