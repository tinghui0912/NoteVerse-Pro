import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  FolderDeleteMode,
  LibraryEntry,
  LibraryFolder,
  LibraryFolderTree,
  LibraryPracticeState,
  LibrarySort,
  LibraryView,
  PaginatedResponse,
} from '@/types/api';

export const libraryApi = {
  folders: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<LibraryFolderTree>>('/library/folders', undefined, { signal }),
  createFolder: (input: { name: string; parent_folder_id?: string | null }) =>
    apiClient.post<ApiResponse<LibraryFolder>>('/library/folders', input),
  updateFolder: (
    folderId: string,
    input: { name?: string; parent_folder_id?: string | null; position?: number }
  ) => apiClient.patch<ApiResponse<LibraryFolder>>(`/library/folders/${folderId}`, input),
  deleteFolder: (folderId: string, mode: FolderDeleteMode = 'MOVE_CONTENTS_TO_PARENT') =>
    apiClient.delete<ApiResponse<never>>(
      `/library/folders/${folderId}?mode=${encodeURIComponent(mode)}`
    ),
  entries: (
    params: {
      view?: LibraryView;
      folder_id?: string;
      search?: string;
      sort?: LibrarySort;
      page: number;
      page_size: number;
    },
    signal?: AbortSignal
  ) => apiClient.get<PaginatedResponse<LibraryEntry>>('/library/entries', params, { signal }),
  updateEntry: (
    entryId: string,
    input: {
      practice_state?: LibraryPracticeState;
      is_favorite?: boolean;
    }
  ) => apiClient.patch<ApiResponse<LibraryEntry>>(`/library/entries/${entryId}`, input),
  batchMove: (input: { entry_ids: string[]; target_folder_id?: string | null }) =>
    apiClient.post<ApiResponse<{ moved: number }>>('/library/entries/batch-move', input),
  batchFavorite: (input: { entry_ids: string[] }) =>
    apiClient.post<ApiResponse<{ updated: number }>>('/library/entries/batch-favorite', input),
  batchTrash: (input: { entry_ids: string[] }) =>
    apiClient.post<ApiResponse<{ updated: number }>>('/library/entries/batch-trash', input),
  batchPracticeState: (input: { entry_ids: string[]; practice_state: LibraryPracticeState }) =>
    apiClient.post<ApiResponse<{ updated: number }>>(
      '/library/entries/batch-practice-state',
      input
    ),
  batchSelfAdd: (input: { score_ids: string[] }) =>
    apiClient.post<ApiResponse<{ added: number }>>('/library/entries/batch-self-add', input),
};
