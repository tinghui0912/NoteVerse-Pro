import { libraryQueryKeys } from '@/features/library/query-keys';
// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  useLibraryScores,
  useFavoriteLibraryScores,
  useMoveLibraryScores,
} from '@/features/library/queries';
const api = vi.hoisted(() => ({
  scores: vi.fn(),
  batchFavorite: vi.fn(),
  batchMove: vi.fn(),
}));
vi.mock('@/features/library/api', () => ({ libraryApi: api }));
it('queries workspace pages and refreshes organization after mutations', async () => {
  api.scores.mockResolvedValue({ data: [{ score_id: 'shared' }] });
  api.batchFavorite.mockResolvedValue({ data: { updated: 1 } });
  api.batchMove.mockResolvedValue({ data: { moved: 1 } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      query: useLibraryScores({
        view: 'shared_with_me',
        page: 1,
        pageSize: 20,
      }),
      favorite: useFavoriteLibraryScores(),
      move: useMoveLibraryScores(),
    }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
  expect(api.scores.mock.calls[0][0]).toMatchObject({
    view: 'shared_with_me',
    page: 1,
    page_size: 20,
  });
  await act(async () => {
    await hook.result.current.favorite.mutateAsync({
      score_ids: ['shared'],
      is_favorite: false,
    });
  });
  await act(async () => {
    await hook.result.current.move.mutateAsync({
      score_ids: ['shared'],
      target_folder_id: null,
    });
  });
  expect(api.batchFavorite).toHaveBeenCalledWith({
    score_ids: ['shared'],
    is_favorite: false,
  });
  expect(api.batchMove).toHaveBeenCalledWith({
    score_ids: ['shared'],
    target_folder_id: null,
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: libraryQueryKeys.all });
  client.clear();
});
