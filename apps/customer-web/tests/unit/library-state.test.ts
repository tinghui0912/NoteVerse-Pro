import { describe, expect, it } from 'vitest';
import {
  buildLibraryHref,
  normalizeLibraryView,
  sortedLibraryFolders,
  normalizeLibrarySort,
  normalizePage,
} from '@/lib/library/state';
import type { LibraryFolderRead } from '@/generated/api';

function folder(
  folderId: string,
  name: string,
  position = 0,
): LibraryFolderRead {
  return {
    folder_id: folderId,
    name,
    position,
    score_count: 0,
    created_at: '2026-06-25T00:00:00.000000Z',
    updated_at: '2026-06-25T00:00:00.000000Z',
  };
}

describe('library organization', () => {
  const folders = [
    folder('b', 'Beta', 2),
    folder('a', 'Alpha', 1),
    folder('c', 'Gamma', 1),
  ];

  it('normalizes unknown library views to all', () => {
    expect(normalizeLibraryView('favorites')).toBe('favorites');
    expect(normalizeLibraryView('not-real')).toBe('all');
    expect(normalizeLibraryView(undefined)).toBe('all');
  });

  it('sorts folders by position then name without mutating the input', () => {
    expect(sortedLibraryFolders(folders).map((item) => item.folder_id)).toEqual(
      ['a', 'c', 'b'],
    );
    expect(folders.map((item) => item.folder_id)).toEqual(['b', 'a', 'c']);
  });

  it('normalizes library sort and page state', () => {
    expect(normalizeLibrarySort('name_asc')).toBe('name_asc');
    expect(normalizeLibrarySort('updated_asc')).toBe('updated_desc');
    expect(normalizePage('2')).toBe(2);
    expect(normalizePage('-1')).toBe(1);
    expect(normalizePage('nope')).toBe(1);
  });

  it('builds library URLs for virtual views, folders, filters, and pagination', () => {
    expect(
      buildLibraryHref(
        { view: 'all', search: 'bach', sort: 'updated_desc' },
        { view: 'favorites', folder: null },
      ),
    ).toBe('/library?view=favorites&search=bach');
    expect(
      buildLibraryHref(
        { view: 'favorites', search: 'bach', sort: 'updated_desc' },
        { folder: 'folder-1', page: 2 },
      ),
    ).toBe('/library?folder=folder-1&search=bach&page=2');
    expect(
      buildLibraryHref(
        {
          view: 'all',
          folderId: 'folder-1',
          search: 'bach',
          sort: 'updated_desc',
        },
        { search: null, sort: 'name_asc' },
      ),
    ).toBe('/library?folder=folder-1&sort=name_asc');
  });
});
