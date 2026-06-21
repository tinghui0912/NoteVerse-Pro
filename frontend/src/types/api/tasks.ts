export type TaskState = 'PENDING' | 'PROGRESS' | 'PENDING_REVIEW' | 'SUCCESS' | 'FAILURE';

export interface Task {
  task_id: string;
  state: TaskState;
  progress: number;
  current_step?: string;
  title?: string;
  difficulty?: string;
  thumbnail_type?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  code?: string;
}

export interface TaskDetails extends Task {
  steps: TaskStep[];
  files: Record<string, TaskFile[]>;
}

export interface TaskStep {
  name: string;
  status: string;
  start_time?: string;
  end_time?: string;
}

export interface TaskFile {
  storage_key: string;
  filename: string;
  page_number?: number;
  size?: number;
  mime_type?: string;
  created_at?: string;
}

export interface BatchSubmitRequest {
  file_ids: string[];
  idempotency_key?: string;
  options?: Record<string, unknown>;
}

export interface BatchStatusResponse {
  tasks: Record<string, {
    state: TaskState;
    progress: number;
    error?: string;
  }>;
}

export interface BatchDeleteResponse {
  deleted_count: number;
  skipped_running: number;
  not_found: number;
}

export interface ArchiveResult {
  blob: Blob;
  downloadedCount: number;
  skippedCount: number;
}
