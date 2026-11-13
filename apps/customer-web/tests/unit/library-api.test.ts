import { beforeEach, expect, it, vi } from 'vitest';
import { libraryApi } from '@/lib/api/library';
const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: client }));
beforeEach(() => vi.clearAllMocks());
it('reads accessible Scores with independent view and folder filters', () => {
  const controller = new AbortController();
  const params = {
    view: 'shared_with_me' as const,
    folder_id: 'folder',
    page: 2,
    page_size: 20,
  };
  libraryApi.scores(params, controller.signal);
  expect(client.get).toHaveBeenCalledWith('/library/scores', params, {
    signal: controller.signal,
  });
});
it('organizes by Score UUID and supports clearing favorite and moving to root', () => {
  libraryApi.batchFavorite({ score_ids: ['score'], is_favorite: false });
  expect(client.post).toHaveBeenCalledWith('/library/scores/batch-favorite', {
    score_ids: ['score'],
    is_favorite: false,
  });
  libraryApi.batchMove({ score_ids: ['score'], target_folder_id: null });
  expect(client.post).toHaveBeenCalledWith('/library/scores/batch-move', {
    score_ids: ['score'],
    target_folder_id: null,
  });
  libraryApi.deleteFolder('folder');
  expect(client.delete).toHaveBeenCalledWith('/library/folders/folder');
});
