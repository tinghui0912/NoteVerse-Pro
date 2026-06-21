export interface Share {
  id: number;
  share_token: string;
  task_id: string;
  expires_at?: string;
  revoked_at?: string;
  can_download: boolean;
  can_edit: boolean;
  created_at?: string;
}

export interface ShareListResponse {
  shares: Share[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateShareResponse {
  share_token: string;
  expires_at: string;
}

export interface SharedTaskInfo {
  task: {
    task_id: string;
    state: string;
    progress: number;
    title?: string;
    difficulty?: string;
    files: Record<string, Array<{
      storage_key: string;
      filename: string;
      page_number?: number;
    }>>;
  };
  share_info: {
    shared_by?: string;
    expires_at?: string;
    can_download: boolean;
    can_edit: boolean;
  };
}

export interface SavedShare {
  id: number;
  share_id: number;
  task_id: string;
  saved_at: string;
}

export interface SavedShareItem {
  id: number;
  share_token: string;
  task_id: string;
  task_title: string;
  task_state: string;
  thumbnail_type?: string;
  shared_by?: string;
  created_at: string;
}

export interface SavedShareListResponse {
  data: SavedShareItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}
