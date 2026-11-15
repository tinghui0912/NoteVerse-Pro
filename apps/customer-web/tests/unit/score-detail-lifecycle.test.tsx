// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import ScorePage from '@/app/[locale]/(app)/score/[id]/page';
import common from '../../messages/en/common.json';
import scoreText from '../../messages/en/score.json';
import { queryKeys } from '@/lib/query-client';
import type { ScoreRead } from '@/generated/api';
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  remove: vi.fn(),
  leave: vi.fn(),
  score: null as ScoreRead | null,
  error: null as Error | null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  usePathname: () => '/score/score',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/i18n/routing', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({
  scoresApi: { batchDelete: (ids: string[]) => mocks.remove(ids) },
  scoreInvitesApi: { leaveScore: (id: string) => mocks.leave(id) },
}));
vi.mock('@/hooks/score-detail/use-score-detail-summary', () => ({
  useScoreDetailSummary: () => ({
    score: mocks.score,
    scoreError: mocks.error,
    scoreLoading: false,
    imageCount: 0,
    revisionAssets: { render_assets: [], revision_sources: [] },
  }),
}));
vi.mock('@/components/score-detail/score-info-panel', () => ({
  ScoreInfoPanel: () => null,
}));
vi.mock('@/components/score-detail/score-versions-panel', () => ({
  ScoreVersionsPanel: () => null,
}));
vi.mock('@/components/score-detail/score-guest-preview-panel', () => ({
  ScoreGuestPreviewPanel: () => null,
}));
vi.mock('@/components/score-detail/score-collaboration-panel', () => ({
  ScoreCollaborationPanel: () => null,
}));
vi.mock('@/components/score-detail/score-hero-actions', () => ({
  ScoreHeroActions: () => null,
}));
vi.mock('@/components/score-detail/score-detail-hero', () => ({
  ScoreDetailHero: ({
    title,
    actions,
  }: {
    title: string;
    actions: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  mocks.remove.mockResolvedValue({ data: { removed: 1 } });
  mocks.leave.mockResolvedValue({ data: null });
  mocks.score = {
    score_id: 'score',
    display_title: 'Owned score',
    genres: [],
    version: 1,
    head_revision_id: 'revision',
    metadata: null,
    input_assets: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    derived_assets: {
      preview: { status: 'pending', asset_id: null },
      audio: { status: 'pending', asset_id: null },
    },
    capabilities: {
      can_view: true,
      can_edit: false,
      can_delete: true,
      can_leave: false,
      can_manage_guest_previews: false,
      can_manage_members: false,
      can_download: false,
      can_practice: false,
    },
  };
});
async function page() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const params = Promise.resolve({ id: 'score' });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="en"
          messages={{ common, score: scoreText, errors: {} }}
        >
          <ScorePage params={params} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  return client;
}
it('uses the Score deletion command and returns an owner to Created by me', async () => {
  const client = await page();
  expect(screen.queryByRole('button', { name: 'Leave score' })).not.toBeInTheDocument();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  expect(
    screen
      .getByRole('navigation', { name: scoreText.breadcrumbLabel })
      .querySelector('a'),
  ).toHaveAttribute('href', '/library');
  await userEvent.click(screen.getByRole('button', { name: 'Delete score' }));
  const dialog = within(screen.getByRole('alertdialog'));
  expect(
    dialog.getByText(scoreText.deleteScoreDescription),
  ).toBeInTheDocument();
  await userEvent.click(dialog.getByRole('button', { name: 'Delete score' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(['score']));
  expect(mocks.push).toHaveBeenCalledWith('/library?view=created_by_me');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.library.all });
  client.clear();
});
it('does not offer owner deletion for a collaborator', async () => {
  mocks.score!.capabilities.can_delete = false;
  mocks.score!.capabilities.can_leave = true;
  const client = await page();
  expect(
    screen.queryByRole('button', { name: 'Delete score' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Leave score' }),
  ).toBeInTheDocument();
  client.clear();
});

it('leaves through current-user membership, clears authorized detail and returns to Shared with me', async () => {
  mocks.score!.capabilities.can_delete = false;
  mocks.score!.capabilities.can_leave = true;
  const client = await page();
  client.setQueryData(queryKeys.scores.detail('score'), { data: mocks.score });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await userEvent.click(screen.getByRole('button', { name: 'Leave score' }));
  const dialog = within(screen.getByRole('alertdialog'));
  expect(dialog.getByText(scoreText.leaveScoreDescription)).toBeInTheDocument();
  expect(dialog.getByRole('heading')).toHaveTextContent('Leave “Owned score”?');
  await userEvent.click(dialog.getByRole('button', { name: 'Leave score' }));
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith('/library?view=shared_with_me'),
  );
  expect(mocks.leave).toHaveBeenCalledWith('score');
  expect(client.getQueryData(queryKeys.scores.detail('score'))).toBeUndefined();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.library.all });
  client.clear();
});
it('returns load errors to Library', async () => {
  mocks.error = new Error('not found');
  mocks.score = null;
  const client = await page();
  expect(
    screen.getByRole('link', { name: scoreText.backToLibrary }),
  ).toHaveAttribute('href', '/library');
  client.clear();
});
