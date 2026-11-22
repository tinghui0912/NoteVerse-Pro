export interface LibraryScoreQueryFilters {
    view?: string;
    folderId?: string;
    search?: string;
    sort?: string;
    page: number;
    pageSize: number;
}

const root = ['library'] as const;

export const libraryQueryKeys = {
  all: root,
  folders: () => [...root, 'folders'] as const,
  scores: () => [...root, 'scores'] as const,
  scoreList: (filters: LibraryScoreQueryFilters) => [...root, 'scores', filters] as const,
};
