import type {
  LibraryFolderRead,
  LibraryPracticeState,
  LibrarySort,
  LibraryView,
} from '@/generated/api';

export type UserSettableLibraryPracticeState = Exclude<
  LibraryPracticeState,
  'IN_PROGRESS'
>;

export type LibrarySortValue = Extract<
  LibrarySort,
  'updated_desc' | 'name_asc'
>;

export function normalizeLibrarySort(value?: string): LibrarySortValue {
  return value === 'name_asc' ? 'name_asc' : 'updated_desc';
}

export function normalizePage(value?: string): number {
  const page = Number(value ?? 1);
  return Number.isFinite(page) ? Math.max(1, page) : 1;
}

export function buildLibraryHref(
  current: {
    view: LibraryView;
    folderId?: string;
    search?: string;
    sort?: string;
  },
  next: {
    view?: LibraryView;
    folder?: string | null;
    search?: string | null;
    sort?: string;
    page?: number;
  },
) {
  const query = new URLSearchParams();
  if (next.folder !== undefined) {
    if (next.folder) query.set('folder', next.folder);
    else query.set('view', next.view ?? 'all');
  } else if (current.folderId) {
    query.set('folder', current.folderId);
  } else {
    query.set('view', next.view ?? current.view);
  }

  const nextSearch = next.search === undefined ? current.search : next.search;
  const nextSort = next.sort ?? current.sort;
  if (nextSearch) query.set('search', nextSearch);
  if (nextSort && nextSort !== 'updated_desc') query.set('sort', nextSort);
  if (next.page && next.page > 1) query.set('page', String(next.page));
  return `/library?${query.toString()}`;
}

const LIBRARY_VIEWS = [
  'all',
  'favorites',
  'recent_practice',
  'to_practice',
  'mastered',
  'trash',
] as const satisfies readonly LibraryView[];

export function normalizeLibraryView(value: string | undefined): LibraryView {
  return LIBRARY_VIEWS.includes(value as LibraryView)
    ? (value as LibraryView)
    : 'all';
}

export function sortedLibraryFolders(folders: LibraryFolderRead[]) {
  return [...folders].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
}
