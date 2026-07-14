import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  FolderDeleteMode,
  LibraryEntry,
  LibraryFolder,
  LibraryFolderTree,
  UserSettableLibraryPracticeState,
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
  batchMove: (input: { entry_ids: string[]; target_folder_id?: string | null }) =>
    apiClient.post<ApiResponse<{ moved: number }>>('/library/entries/batch-move', input),
  batchTrash: (input: { entry_ids: string[] }) =>
    apiClient.post<ApiResponse<{ updated: number }>>('/library/entries/batch-trash', input),
  batchAddOwned: (input: { score_ids: string[] }) =>
    apiClient.post<ApiResponse<{ added: number }>>('/library/entries/batch-add-owned', input),
  batchPracticeState: (input: { entry_ids: string[]; practice_state: UserSettableLibraryPracticeState }) =>
    apiClient.post<ApiResponse<{ updated: number }>>(
      '/library/entries/batch-practice-state',
      input
    ),
};

