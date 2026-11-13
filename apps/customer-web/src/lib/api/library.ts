import { apiClient } from '@/lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@/lib/api-client';
import type {
  LibraryBatchMoveRead,
  LibraryBatchUpdateRead,
  LibraryScoreBatchMoveRequest,
  LibraryScoreBatchFavoriteRequest,
  LibraryScoreRead,
  LibraryFolderCreateRequest,
  LibraryFolderRead,
  LibraryFolderOverviewRead,
  LibraryFolderUpdateRequest,
  ListLibraryScoresApiV1LibraryScoresGetData,
} from '@/generated/api';

export const libraryApi = {
  folders: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<LibraryFolderOverviewRead>>(
      '/library/folders',
      undefined,
      { signal },
    ),
  createFolder: (input: LibraryFolderCreateRequest) =>
    apiClient.post<ApiResponse<LibraryFolderRead>>('/library/folders', input),
  updateFolder: (folderId: string, input: LibraryFolderUpdateRequest) =>
    apiClient.patch<ApiResponse<LibraryFolderRead>>(
      `/library/folders/${folderId}`,
      input,
    ),
  deleteFolder: (folderId: string) =>
    apiClient.delete<ApiResponse<never>>(`/library/folders/${folderId}`),
  scores: (
    params: Omit<
      NonNullable<ListLibraryScoresApiV1LibraryScoresGetData['query']>,
      'folder_id' | 'search'
    > & { folder_id?: string; search?: string },
    signal?: AbortSignal,
  ) =>
    apiClient.get<PaginatedResponse<LibraryScoreRead>>(
      '/library/scores',
      params,
      { signal },
    ),
  batchMove: (input: LibraryScoreBatchMoveRequest) =>
    apiClient.post<ApiResponse<LibraryBatchMoveRead>>(
      '/library/scores/batch-move',
      input,
    ),
  batchFavorite: (input: LibraryScoreBatchFavoriteRequest) =>
    apiClient.post<ApiResponse<LibraryBatchUpdateRead>>(
      '/library/scores/batch-favorite',
      input,
    ),
};
