import { describe, expect, it } from 'vitest';
import {
  folderDepth,
  folderDescendantIds,
  folderLevel,
  folderSubtreeHeight,
  normalizeLibraryView,
  sortedLibraryFolders,
} from '@/lib/library/folder-tree';
import {
  buildLibraryHref,
  normalizeLibrarySort,
  normalizePage,
} from '@/lib/library/state';
import type { LibraryFolder } from '@/types/api';

function folder(
  folderId: string,
  name: string,
  parentFolderId: string | null,
  position = 0
): LibraryFolder {
  return {
    folder_id: folderId,
    parent_folder_id: parentFolderId,
    name,
    position,
    direct_count: 0,
    recursive_count: 0,
    created_at: '2026-06-25T00:00:00.000000Z',
    updated_at: '2026-06-25T00:00:00.000000Z',
  };
}

describe('library folder tree helpers', () => {
  const folders = [
    folder('root-b', 'Beta', null, 2),
    folder('root-a', 'Alpha', null, 1),
    folder('child-a', 'Child A', 'root-a'),
    folder('grandchild-a', 'Grandchild A', 'child-a'),
  ];

  it('normalizes unknown library views to all', () => {
    expect(normalizeLibraryView('favorites')).toBe('favorites');
    expect(normalizeLibraryView('not-real')).toBe('all');
    expect(normalizeLibraryView(undefined)).toBe('all');
  });

  it('calculates depth, level, subtree height, and descendants', () => {
    const root = folders[1];
    const child = folders[2];
    const grandchild = folders[3];

    expect(folderDepth(root, folders)).toBe(0);
    expect(folderDepth(child, folders)).toBe(1);
    expect(folderLevel(grandchild, folders)).toBe(3);
    expect(folderSubtreeHeight(root, folders)).toBe(3);
    expect([...folderDescendantIds(root, folders)]).toEqual(['child-a', 'grandchild-a']);
  });

  it('sorts folders by depth, position, and name', () => {
    expect(sortedLibraryFolders(folders).map((item) => item.folder_id)).toEqual([
      'root-a',
      'root-b',
      'child-a',
      'grandchild-a',
    ]);
  });

  it('normalizes library sort and page state', () => {
    expect(normalizeLibrarySort('name_asc')).toBe('name_asc');
    expect(normalizeLibrarySort('updated_asc')).toBe('updated_desc');
    expect(normalizePage('2')).toBe(2);
    expect(normalizePage('-1')).toBe(1);
    expect(normalizePage('nope')).toBe(1);
  });

  it('builds library URLs for virtual views, folders, filters, and pagination', () => {
    expect(buildLibraryHref(
      { view: 'all', search: 'bach', sort: 'updated_desc' },
      { view: 'favorites', folder: null }
    )).toBe('/library?view=favorites&search=bach');
    expect(buildLibraryHref(
      { view: 'favorites', search: 'bach', sort: 'updated_desc' },
      { folder: 'folder-1', page: 2 }
    )).toBe('/library?folder=folder-1&search=bach&page=2');
    expect(buildLibraryHref(
      { view: 'all', folderId: 'folder-1', search: 'bach', sort: 'updated_desc' },
      { search: null, sort: 'name_asc' }
    )).toBe('/library?folder=folder-1&sort=name_asc');
  });
});
