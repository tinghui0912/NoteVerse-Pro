import type { LibraryFolderCreateRequest, LibraryFolderUpdateRequest, LibraryScoreBatchFavoriteRequest, LibraryScoreBatchMoveRequest, LibraryScoresListData } from '@/generated/api';
import { libraryFolderDelete, libraryFolderUpdate, libraryFoldersCreate, libraryFoldersOverviewGet, libraryScoresBatchFavorite, libraryScoresBatchMove, libraryScoresList } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';

export const libraryApi = {
  folders: (signal?: AbortSignal) =>
    responseData(libraryFoldersOverviewGet({ ...customerTransport.authenticated, signal })),
  createFolder: (input: LibraryFolderCreateRequest) =>
    responseData(libraryFoldersCreate({ ...customerTransport.authenticated, body: input })),
  updateFolder: (folderId: string, input: LibraryFolderUpdateRequest) =>
    responseData(libraryFolderUpdate({ ...customerTransport.authenticated, path: { folder_id: folderId }, body: input })),
  deleteFolder: (folderId: string) =>
    responseData(libraryFolderDelete({ ...customerTransport.authenticated, path: { folder_id: folderId } })),
  scores: (
    params: Omit<
      NonNullable<LibraryScoresListData['query']>,
      'folder_id' | 'search'
    > & { folder_id?: string; search?: string },
    signal?: AbortSignal,
  ) =>
    responseData(libraryScoresList({ ...customerTransport.authenticated, query: params, signal })),
  batchMove: (input: LibraryScoreBatchMoveRequest) =>
    responseData(libraryScoresBatchMove({ ...customerTransport.authenticated, body: input })),
  batchFavorite: (input: LibraryScoreBatchFavoriteRequest) =>
    responseData(libraryScoresBatchFavorite({ ...customerTransport.authenticated, body: input })),
};
