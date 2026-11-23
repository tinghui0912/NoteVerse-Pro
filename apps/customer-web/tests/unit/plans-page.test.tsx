// @vitest-environment jsdom
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
  expect(within(screen.getByRole('main')).getByRole('link', {name: authenticated ? plans.openApp : plans.getStarted})).toHaveAttribute('href', authenticated ? '/library' : '/auth/register');
});
it('uses the same truthful free surface on the homepage', () => {
  render(<HomePage />, {wrapper});
  const section = screen.getByRole('heading', {name: 'Plans'}).closest('section')!;
  expect(within(section).getByText(plans.subtitle)).toBeVisible();
  expect(within(section).getByRole('link', {name: plans.getStarted})).toHaveAttribute('href', '/auth/register');
});
it('links public navigation to Plans', () => {
  render(<PublicNav />, {wrapper});
  expect(screen.getByRole('link', {name: 'Plans'})).toHaveAttribute('href', '/plans');
});
it('composes Account and Storage settings navigation', () => {
  render(<SettingsShell><p>Storage content</p></SettingsShell>, {wrapper});
  expect(screen.getByRole('link', {name: 'Storage'})).toHaveAttribute('href', '/settings/storage');
  expect(screen.getByRole('link', {name: 'Profile'})).toHaveAttribute('href', '/settings/profile');
});


it.each([false, true])('composes Homepage registration/upload and app navigation (authenticated=%s)', (authenticated) => {
  fake.authenticated = authenticated;render(<HomePage />, {wrapper});
  const label = authenticated ? home.uploadScore : plans.getStarted;
  const primaryLinks = screen.getAllByRole('link', {name: label});
  expect(primaryLinks.length).toBeGreaterThan(0);
  for (const link of primaryLinks) expect(link).toHaveAttribute('href', authenticated ? '/upload' : '/auth/register');
  const section = screen.getByRole('heading', {name: 'Plans'}).closest('section')!;
  expect(within(section).getByRole('link', {name: authenticated ? plans.openApp : plans.getStarted})).toHaveAttribute('href', authenticated ? '/library' : '/auth/register');
  expect(new Set(screen.getAllByRole('link').map(link => link.getAttribute('href')))).toEqual(new Set(authenticated ? ['/', '/upload', '/library'] : ['/', '/auth/register']));
  expect(screen.getByText(home.step2Desc)).toBeVisible();
  expect(screen.getByText(home.step3Desc)).toBeVisible();
});
