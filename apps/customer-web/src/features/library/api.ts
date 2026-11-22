import type { LibraryFolderCreateRequest, LibraryFolderUpdateRequest, LibraryScoreBatchFavoriteRequest, LibraryScoreBatchMoveRequest, LibraryScoresListData } from '@/generated/api';
import { libraryFolderDelete, libraryFolderUpdate, libraryFoldersCreate, libraryFoldersOverviewGet, libraryScoresBatchFavorite, libraryScoresBatchMove, libraryScoresList } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const libraryApi = {
  folders: (signal?: AbortSignal) =>
    responseBody(libraryFoldersOverviewGet({ ...customerTransport.authenticated, signal })),
  createFolder: (input: LibraryFolderCreateRequest) =>
    responseBody(libraryFoldersCreate({ ...customerTransport.authenticated, body: input })),
  updateFolder: (folderId: string, input: LibraryFolderUpdateRequest) =>
    responseBody(libraryFolderUpdate({ ...customerTransport.authenticated, path: { folder_id: folderId }, body: input })),
  deleteFolder: (folderId: string) =>
    responseComplete(libraryFolderDelete({ ...customerTransport.authenticated, path: { folder_id: folderId } })),
  scores: (
    params: Omit<
      NonNullable<LibraryScoresListData['query']>,
      'folder_id' | 'search'
    > & { folder_id?: string; search?: string },
    signal?: AbortSignal,
  ) =>
    responseBody(libraryScoresList({ ...customerTransport.authenticated, query: params, signal })),
  batchMove: (input: LibraryScoreBatchMoveRequest) =>
    responseBody(libraryScoresBatchMove({ ...customerTransport.authenticated, body: input })),
  batchFavorite: (input: LibraryScoreBatchFavoriteRequest) =>
    responseBody(libraryScoresBatchFavorite({ ...customerTransport.authenticated, body: input })),
};
