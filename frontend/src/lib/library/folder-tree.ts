import type { LibraryFolder, LibraryView } from '@/types/api';

export const MAX_LIBRARY_FOLDER_LEVEL = 2;

export const LIBRARY_VIEWS = [
  'all',
  'favorites',
  'recent_practice',
  'to_practice',
  'mastered',
  'bookmarks',
  'archived',
  'trash',
] as const satisfies readonly LibraryView[];

export function normalizeLibraryView(value: string | undefined): LibraryView {
  return LIBRARY_VIEWS.includes(value as LibraryView) ? (value as LibraryView) : 'all';
}

export function folderDepth(folder: LibraryFolder, folders: LibraryFolder[]): number {
  let depth = 0;
  let parentId = folder.parent_folder_id;
  while (parentId) {
    const parent = folders.find((item) => item.folder_id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parent_folder_id;
  }
  return depth;
}

export function folderLevel(folder: LibraryFolder, folders: LibraryFolder[]): number {
  return folderDepth(folder, folders) + 1;
}

export function folderSubtreeHeight(folder: LibraryFolder, folders: LibraryFolder[]): number {
  const childHeights: number[] = folders
    .filter((item) => item.parent_folder_id === folder.folder_id)
    .map((child) => folderSubtreeHeight(child, folders));
  return 1 + (childHeights.length ? Math.max(...childHeights) : 0);
}

export function folderDescendantIds(folder: LibraryFolder, folders: LibraryFolder[]) {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    for (const item of folders) {
      if (item.parent_folder_id === parentId) {
        result.add(item.folder_id);
        visit(item.folder_id);
      }
    }
  };
  visit(folder.folder_id);
  return result;
}

export function sortedLibraryFolders(folders: LibraryFolder[]) {
  return [...folders].sort((a, b) => {
    const depthDelta = folderDepth(a, folders) - folderDepth(b, folders);
    if (depthDelta !== 0) return depthDelta;
    return a.position - b.position || a.name.localeCompare(b.name);
  });
}
