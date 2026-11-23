// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import PlansPage from '@/app/[locale]/(public)/plans/page';
import HomePage from '@/app/[locale]/(public)/page';
import { PublicNav } from '@/components/navigation/public-nav';
import { SettingsShell } from '@/components/settings/settings-shell';
import plans from '@/../messages/en/plans.json';
import common from '@/../messages/en/common.json';
import home from '@/../messages/en/home.json';
import settings from '@/../messages/en/settings.json';

const fake = vi.hoisted(() => ({authenticated: false}));
vi.mock('@/features/authentication/session/authentication-context', () => ({useAuthentication: () => ({isAuthenticated: fake.authenticated, isLoading: false})}));
vi.mock('@/i18n/routing', () => ({
  routing: {defaultLocale: 'en'}, usePathname: () => '/settings/storage', useRouter: () => ({push: vi.fn(), replace: vi.fn()}),
  Link: ({href, children, ...props}: PropsWithChildren<{href: string}>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/navigation/nav-actions', () => ({AuthenticatedNavActions: () => <span>Session actions</span>, LanguageSwitcher: () => <span>Language</span>}));
vi.mock('@/components/marketing/animated-section', () => ({AnimatedSection: ({children, id}: PropsWithChildren<{id?: string}>) => <section id={id}>{children}</section>}));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams()}));
const wrapper = ({children}: PropsWithChildren) => <NextIntlClientProvider locale="en" messages={{plans, common, home, settings}}>{children}</NextIntlClientProvider>;
beforeEach(() => {fake.authenticated = false;});
it.each([false, true])('shows current free access and a real CTA (authenticated=%s)', (authenticated) => {
  fake.authenticated = authenticated;render(<PlansPage />, {wrapper});
  expect(screen.getByRole('heading', {name: 'Plans'})).toBeVisible();
  expect(screen.getByText(plans.freeName)).toBeVisible();
  expect(screen.getByText(plans.subtitle)).toBeVisible();
  expect(screen.getByRole('link', {name: authenticated ? plans.openApp : plans.getStarted})).toHaveAttribute('href', authenticated ? '/library' : '/auth/register');
  expect(screen.queryByRole('button', {name: /choose plan|upgrade|checkout|coming soon/i})).toBeNull();
  expect(screen.queryByText(/Basic Plan|Pro Plan|¥30|¥99|recognitions per month|priority support|multi-device sync/)).toBeNull();
});
it('uses the same truthful free surface on the homepage', () => {
  render(<HomePage />, {wrapper});
  const section = screen.getByRole('heading', {name: 'Plans'}).closest('section')!;
  expect(within(section).getByText(plans.subtitle)).toBeVisible();
  expect(within(section).getByRole('link', {name: plans.getStarted})).toHaveAttribute('href', '/auth/register');
  expect(within(section).queryByText(/Basic Plan|Pro Plan|recognitions per month/)).toBeNull();
});
it('links public navigation to Plans', () => {
  render(<PublicNav />, {wrapper});
  expect(screen.getByRole('link', {name: 'Plans'})).toHaveAttribute('href', '/plans');
});
it('composes Account and Storage settings navigation', () => {
  render(<SettingsShell><p>Storage content</p></SettingsShell>, {wrapper});
  expect(screen.getByRole('link', {name: 'Storage'})).toHaveAttribute('href', '/settings/storage');
  expect(screen.getByRole('link', {name: 'Profile'})).toHaveAttribute('href', '/settings/profile');
  expect(screen.queryByRole('link', {name: 'Billing'})).toBeNull();
});

it('owns the canonical public Plans route', () => {
  const root = resolve(process.cwd(), 'src/app/[locale]/(public)');
  expect(existsSync(resolve(root, 'plans/page.tsx'))).toBe(true);
  expect(existsSync(resolve(root, 'subscriptions'))).toBe(false);
});
