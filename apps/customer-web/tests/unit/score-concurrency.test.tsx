// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ScoreInfoPanel } from '@/components/score-detail/score-info-panel';
import { ScoreVersionsPanel } from '@/components/score-detail/score-versions-panel';
import { useCreateRevision, useScoreDetail } from '@/hooks/queries/use-score-queries';
import type { ScoreRead } from '@/generated/api';
import { queryKeys } from '@/lib/query-client';
import common from '../../messages/en/common.json';
import score from '../../messages/en/score.json';
import scoreStyles from '../../messages/en/scoreStyles.json';
import errors from '../../messages/en/errors.json';
import zhErrors from '../../messages/zh/errors.json';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { useTranslations } from 'next-intl';

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  update: vi.fn(),
  restore: vi.fn(),
  create: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/i18n/routing', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({
  scoresApi: {
    detail: api.detail,
    update: api.update,
    restoreRevision: api.restore,
    createRevision: api.create,
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock('@/components/score/score-capability-context', () => ({
  useScoreCapabilities: () => ({ capabilities: { can_edit: true } }),
}));
vi.mock('@/hooks/queries/use-score-queries', async (original) => ({
  ...(await original<typeof import('@/hooks/queries/use-score-queries')>()),
  useScoreRevisions: () => ({
    data: {
      pages: [
        {
          items: [
            {
              revision_id: 'r2',
              revision_number: 2,
              origin: 'EDIT',
              created_at: '2026-01-01T00:00:00Z',
              created_by: null,
              restore: null,
              note: null,
            },
          ],
        },
      ],
    },
    error: null,
    isLoading: false,
    hasNextPage: false,
  }),
}));

let client: QueryClient;
const initial: ScoreRead = {
  score_id: 'score',
  display_title: 'Original',
  genres: ['classical'],
  metadata_version: 1,
  head_revision_id: 'r5',
  head_revision_number: 5,
  metadata: null,
  input_assets: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  derived_assets: {
    preview: { status: 'pending', asset_id: null },
    audio: { status: 'pending', asset_id: null },
  },
  capabilities: {
    can_view: true,
    can_edit: true,
    can_delete: true,
    can_download: true,
    can_practice: true,
    can_leave: false,
    can_manage_members: true,
    can_manage_guest_previews: true,
  },
};
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.scores.detail('score'), initial);
  api.detail.mockResolvedValue(initial);
});
afterEach(() => client.clear());
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ common, score, scoreStyles, errors }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function MetadataPanel() {
  const { data } = useScoreDetail('score');
  return data ? (
    <ScoreInfoPanel
      scoreId={data.score_id}
      displayTitle={data.display_title}
      metadataVersion={data.metadata_version}
      genres={data.genres}
      imageCount={0}
      canEditDisplayTitle
    />
  ) : null;
}

it('uses the returned metadata token for a following title or genre edit', async () => {
  api.update
    .mockResolvedValueOnce({ ...initial, display_title: 'Renamed', metadata_version: 2 })
    .mockResolvedValueOnce({
      ...initial,
      display_title: 'Renamed',
      genres: [],
      metadata_version: 3,
    });
  const user = userEvent.setup();
  render(<MetadataPanel />, { wrapper });
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  await user.clear(screen.getByRole('textbox', { name: 'Name' }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Renamed{Enter}');
  await screen.findByText('Renamed');
  expect(api.update).toHaveBeenNthCalledWith(1, 'score', {
    display_title: 'Renamed',
    expected_metadata_version: 1,
  });
  await user.click(screen.getByRole('button', { name: 'Remove Classical' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
  expect(api.update).toHaveBeenNthCalledWith(2, 'score', {
    genres: [],
    expected_metadata_version: 2,
  });
  await waitFor(() =>
    expect(client.getQueryData<ScoreRead>(queryKeys.scores.detail('score'))?.metadata_version).toBe(
      3,
    ),
  );
});

it('invalidates notation representations then refetches head facts without inventing a metadata token', async () => {
  api.create.mockResolvedValue({ revision_id: 'r6', revision_number: 6 });
  api.detail.mockResolvedValue({ ...initial, head_revision_id: 'r6', head_revision_number: 6 });
  const command = renderHook(useCreateRevision, { wrapper });
  await act(async () => {
    await command.result.current.mutateAsync({
      scoreId: 'score',
      content: '<score-partwise/>',
      expected_head_revision_id: 'r5',
    });
  });
  expect(client.getQueryState(queryKeys.scores.detail('score'))?.isInvalidated).toBe(true);
  expect(client.getQueryData(queryKeys.scores.detail('score'))).toEqual(initial);
  const detail = renderHook(() => useScoreDetail('score'), { wrapper });
  await waitFor(() => expect(detail.result.current.data?.head_revision_number).toBe(6));
  expect(detail.result.current.data?.head_revision_id).toBe('r6');
  expect(detail.result.current.data?.metadata_version).toBe(1);
});

it('restores against the head observed when the confirmation was opened', async () => {
  api.restore.mockResolvedValue({ revision_id: 'r7', revision_number: 7 });
  const user = userEvent.setup();
  const view = render(<ScoreVersionsPanel scoreId="score" headRevisionId="r5" canRestore />, {
    wrapper,
  });
  await user.click(screen.getByRole('button', { name: 'Version actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Restore this version' }));
  view.rerender(<ScoreVersionsPanel scoreId="score" headRevisionId="r6" canRestore />);
  await user.click(screen.getByRole('button', { name: 'Restore this version' }));
  await waitFor(() =>
    expect(api.restore).toHaveBeenCalledWith('score', 'r2', {
      expected_head_revision_id: 'r5',
      note: null,
    }),
  );
});

it('offers no restore command when there is no observed head', async () => {
  const user = userEvent.setup();
  render(<ScoreVersionsPanel scoreId="score" headRevisionId={null} canRestore />, { wrapper });
  await user.click(screen.getByRole('button', { name: 'Version actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Restore this version' })).not.toBeInTheDocument();
  expect(api.restore).not.toHaveBeenCalled();
});

it.each(['en', 'zh'] as const)('distinguishes metadata and revision conflicts in %s', (locale) => {
  const messages = locale === 'en' ? errors : zhErrors;
  const { result } = renderHook(
    () => {
      const t = useTranslations('errors');
      return ['score_metadata_conflict', 'revision_conflict'].map((code) =>
        userFacingErrorMessage(t, { code }),
      );
    },
    {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale={locale} messages={{ errors: messages }}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );
  expect(result.current).toEqual([messages.score_metadata_conflict, messages.revision_conflict]);
  expect(result.current[0]).not.toBe(result.current[1]);
});

it('disables a pending restore confirmation if the Score no longer has a head', async () => {
  const user = userEvent.setup();
  const view = render(<ScoreVersionsPanel scoreId="score" headRevisionId="r5" canRestore />, {
    wrapper,
  });
  await user.click(screen.getByRole('button', { name: 'Version actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Restore this version' }));
  view.rerender(<ScoreVersionsPanel scoreId="score" headRevisionId={null} canRestore />);
  const confirm = screen.getByRole('button', { name: 'Restore this version' });
  expect(confirm).toBeDisabled();
  await user.click(confirm);
  expect(api.restore).not.toHaveBeenCalled();
});
