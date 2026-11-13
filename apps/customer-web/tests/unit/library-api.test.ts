import { libraryApi } from '@/lib/api/library';
import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../helpers/customer-http';
afterEach(() => vi.unstubAllGlobals());
it('reads accessible Scores using generated query encoding', async () => {
  const send = customerFetch();
  await libraryApi.scores({ view: 'shared_with_me', folder_id: 'folder', page: 2, page_size: 20 });
  const request = send.mock.calls[0][0] as Request;
  const url = new URL(request.url);
  expect(url.pathname).toBe('/api/v1/library/scores');
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'shared_with_me', folder_id: 'folder', page: '2', page_size: '20' });
});
it('organizes by Score UUID including unfavorite and root movement', async () => {
  const send = customerFetch();
  await libraryApi.batchFavorite({ score_ids: ['score'], is_favorite: false });
  expect(await (send.mock.calls[0][0] as Request).json()).toEqual({ score_ids: ['score'], is_favorite: false });
  await libraryApi.batchMove({ score_ids: ['score'], target_folder_id: null });
  expect(await (send.mock.calls[1][0] as Request).json()).toEqual({ score_ids: ['score'], target_folder_id: null });
  await libraryApi.deleteFolder('folder');
  expect((send.mock.calls[2][0] as Request).method).toBe('DELETE');
});
