import type { LibraryFolderRead } from '@/generated/api';

export function sortedLibraryFolders(folders: LibraryFolderRead[]) {
  return [...folders].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
}
