'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { libraryApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { FolderDeleteMode, LibrarySort, LibraryView, UserSettableLibraryPracticeState } from '@/types/api';

export function useLibraryFolders() {
  return useQuery({
    queryKey: queryKeys.library.folders(),
    queryFn: ({ signal }) => libraryApi.folders(signal),
  });
}

export function useLibraryEntries(params: {
  view?: LibraryView;
  folderId?: string;
  search?: string;
  sort?: LibrarySort;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: queryKeys.library.entryList(params),
    queryFn: ({ signal }) =>
      libraryApi.entries(
        {
          view: params.view,
          folder_id: params.folderId,
          search: params.search || undefined,
          sort: params.sort,
          page: params.page,
          page_size: params.pageSize,
        },
        signal
      ),
  });
}

export function useCreateLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: libraryApi.createFolder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useUpdateLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, ...input }: {
      folderId: string;
      name?: string;
      parent_folder_id?: string | null;
      position?: number;
    }) => libraryApi.updateFolder(folderId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useDeleteLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, mode }: { folderId: string; mode?: FolderDeleteMode }) =>
      libraryApi.deleteFolder(folderId, mode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useMoveLibraryEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: libraryApi.batchMove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useFavoriteLibraryEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: libraryApi.batchFavorite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useTrashLibraryEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: libraryApi.batchTrash,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useSetLibraryEntriesPracticeState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: libraryApi.batchPracticeState,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useUpdateLibraryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      ...input
    }: {
      entryId: string;
      practice_state?: UserSettableLibraryPracticeState;
      is_favorite?: boolean;
    }) => libraryApi.updateEntry(entryId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

