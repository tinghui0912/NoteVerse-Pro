'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { libraryApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type {
  LibraryScoreBatchMoveRequest,
  LibraryScoreBatchFavoriteRequest,
  LibraryFolderCreateRequest,
  LibraryFolderUpdateRequest,
  LibrarySort,
  LibraryView,
} from '@/generated/api';

export function useLibraryFolders() {
  return useQuery({
    queryKey: queryKeys.library.folders(),
    queryFn: ({ signal }) => libraryApi.folders(signal),
  });
}

export function useLibraryScores(params: {
  view?: LibraryView;
  folderId?: string;
  search?: string;
  sort?: LibrarySort;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: queryKeys.library.scoreList(params),
    queryFn: ({ signal }) =>
      libraryApi.scores(
        {
          view: params.view,
          folder_id: params.folderId,
          search: params.search || undefined,
          sort: params.sort,
          page: params.page,
          page_size: params.pageSize,
        },
        signal,
      ),
  });
}

export function useCreateLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LibraryFolderCreateRequest) =>
      libraryApi.createFolder(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useUpdateLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      folderId,
      ...input
    }: {
      folderId: string;
    } & LibraryFolderUpdateRequest) => libraryApi.updateFolder(folderId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useDeleteLibraryFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => libraryApi.deleteFolder(folderId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useMoveLibraryScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LibraryScoreBatchMoveRequest) =>
      libraryApi.batchMove(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}

export function useFavoriteLibraryScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LibraryScoreBatchFavoriteRequest) =>
      libraryApi.batchFavorite(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  });
}
