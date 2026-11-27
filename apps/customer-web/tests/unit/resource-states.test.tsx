// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { ResourceLoadError } from '@/components/states';
import { ResourceLoading } from '@/components/loading';
vi.mock('@/i18n/routing', () => ({Link: ({href, children}: PropsWithChildren<{href: string}>) => <a href={href}>{children}</a>}));
it('shows a loading resource label', () => {
  render(<ResourceLoading label="Loading score" />);
  expect(screen.getByText('Loading score')).toBeVisible();
});
it('offers a caller-owned retry after resource failure', async () => {
  const retry = vi.fn();
  render(<ResourceLoadError title="Score unavailable" description="Please retry." actionLabel="Retry" onAction={retry} />);
  expect(screen.getByRole('heading', {name: 'Score unavailable'})).toBeVisible();
  await userEvent.click(screen.getByRole('button', {name: 'Retry'}));
  expect(retry).toHaveBeenCalledOnce();
});
it('offers a resource recovery destination', () => {
  render(<ResourceLoadError title="Score unavailable" description="Return to your collection." actionLabel="Open Library" actionHref="/library" />);
  expect(screen.getByRole('link', {name: 'Open Library'})).toHaveAttribute('href', '/library');
});
