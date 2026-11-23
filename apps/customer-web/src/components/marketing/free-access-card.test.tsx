// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { FreeAccessCard } from './free-access-card';
import { MarketingFooter } from './marketing-footer';
import plans from '@/../messages/en/plans.json';
import home from '@/../messages/en/home.json';
import common from '@/../messages/en/common.json';
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: PropsWithChildren<{href: string}>) => <a href={href}>{children}</a>}));
it('renders caller-supplied card navigation as presentation', () => {
  render(<NextIntlClientProvider locale="en" messages={{plans}}><FreeAccessCard ctaHref="/auth/register" ctaLabel="Create an account" /></NextIntlClientProvider>);
  expect(screen.getByText(plans.freeName)).toBeVisible();
  expect(screen.getByRole('link', {name: 'Create an account'})).toHaveAttribute('href', '/auth/register');
});
it('renders caller-supplied footer navigation as presentation', () => {
  render(<NextIntlClientProvider locale="en" messages={{home, common}}><MarketingFooter ctaHref="/library" ctaLabel="Open Library" /></NextIntlClientProvider>);
  expect(screen.getByRole('link', {name: 'Open Library'})).toHaveAttribute('href', '/library');
});
