import type { ScoreMetadata, ScoreState, ScoreTaxonomyTag } from './scores';

export type LibraryEntrySourceType =
  | 'SELF_ADDED'
  | 'BOOKMARK'
  | 'SHARED'
  | 'OFFICIAL'
  | 'AI_RECOMMENDED';
export type LibraryPracticeState = 'TO_PRACTICE' | 'IN_PROGRESS' | 'MASTERED';
export type LibraryView =
  | 'all'
  | 'favorites'
  | 'recent_practice'
  | 'to_practice'
  | 'mastered'
  | 'bookmarks'
  | 'archived'
  | 'trash';
export type LibrarySort =
  | 'updated_desc'
  | 'updated_asc'
  | 'name_asc'
  | 'name_desc'
  | 'opened_desc'
  | 'practiced_desc';

export type FolderDeleteMode =
  | 'MOVE_CONTENTS_TO_PARENT'
  | 'MOVE_CONTENTS_TO_ROOT'
  | 'TRASH_CONTENTS';

export interface LibraryFolder {
  folder_id: string;
  parent_folder_id: string | null;
  name: string;
  position: number;
  direct_count: number;
  recursive_count: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryFolderTree {
  all_count: number;
  favorite_count: number;
  recent_practice_count: number;
  to_practice_count: number;
  mastered_count: number;
  folders: LibraryFolder[];
}

export interface LibraryEntry {
  entry_id: string;
  score_id: string;
  source_type: LibraryEntrySourceType;
  folder_id: string | null;
  title: string;
  score_state: ScoreState;
  taxonomy_tags: ScoreTaxonomyTag[];
  metadata: ScoreMetadata | null;
  is_favorite: boolean;
  is_archived: boolean;
  practice_state: LibraryPracticeState;
  available: boolean;
  unavailable_reason: string | null;
  pinned_at: string | null;
  last_opened_at: string | null;
  last_practiced_at: string | null;
  created_at: string;
  updated_at: string;
}
