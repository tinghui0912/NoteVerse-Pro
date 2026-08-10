import { apiClient } from '@/lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@/lib/api-client';
import type {
  FolderDeleteMode,
  ApiResponseLibraryBatchMoveRead,
  ApiResponseLibraryBatchUpdateRead,
  ApiResponseLibraryOwnedScoreBatchRead,
  LibraryEntryBatchMoveRequest,
  LibraryEntryBatchPracticeStateRequest,
  LibraryEntryBatchUpdateRequest,
  LibraryEntryRead,
  LibraryFolderCreateRequest,
  LibraryFolderRead,
  LibraryFolderTreeRead,
  LibraryFolderUpdateRequest,
  ListLibraryEntriesApiV1LibraryEntriesGetData,
  LibraryOwnedScoreBatchRequest,
} from '@/generated/api';

export const libraryApi = {
  folders: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<LibraryFolderTreeRead>>('/library/folders', undefined, { signal }),
  createFolder: (input: LibraryFolderCreateRequest) =>
    apiClient.post<ApiResponse<LibraryFolderRead>>('/library/folders', input),
  updateFolder: (
    folderId: string,
    input: LibraryFolderUpdateRequest
  ) => apiClient.patch<ApiResponse<LibraryFolderRead>>(`/library/folders/${folderId}`, input),
  deleteFolder: (folderId: string, mode: FolderDeleteMode = 'MOVE_CONTENTS_TO_PARENT') =>
    apiClient.delete<ApiResponse<never>>(
      `/library/folders/${folderId}?mode=${encodeURIComponent(mode)}`
    ),
  entries: (
    params: Omit<NonNullable<ListLibraryEntriesApiV1LibraryEntriesGetData['query']>, 'folder_id' | 'search'> & {
      folder_id?: string;
      search?: string;
    },
    signal?: AbortSignal
  ) => apiClient.get<PaginatedResponse<LibraryEntryRead>>('/library/entries', params, { signal }),
  batchMove: (input: LibraryEntryBatchMoveRequest) =>
    apiClient.post<ApiResponseLibraryBatchMoveRead>('/library/entries/batch-move', input),
  batchTrash: (input: LibraryEntryBatchUpdateRequest) =>
    apiClient.post<ApiResponseLibraryBatchUpdateRead>('/library/entries/batch-trash', input),
  batchAddOwned: (input: LibraryOwnedScoreBatchRequest) =>
    apiClient.post<ApiResponseLibraryOwnedScoreBatchRead>('/library/entries/batch-add-owned', input),
  batchPracticeState: (input: LibraryEntryBatchPracticeStateRequest) =>
    apiClient.post<ApiResponseLibraryBatchUpdateRead>(
      '/library/entries/batch-practice-state',
      input
    ),
};

