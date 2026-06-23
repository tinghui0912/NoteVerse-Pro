export type ProcessingJobState =
  | 'PENDING'
  | 'PROGRESS'
  | 'PENDING_REVIEW'
  | 'SUCCESS'
  | 'FAILURE';

export interface ProcessingJob {
  job_id: string;
  score_id?: string;
  state: ProcessingJobState;
  progress: number;
  current_step?: string;
  title?: string;
  taxonomy_tags?: Array<{ category: string; code: string }>;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  code?: string;
  artifacts?: Record<string, ProcessingArtifact[]>;
  upload_ids?: Array<{ upload_id?: number; sha256: string; original_filename?: string }>;
}

export interface ProcessingArtifact {
  artifact_id: string;
  storage_backend: string;
  storage_key: string;
  filename: string;
  page_number?: number;
  size?: number;
  mime_type?: string;
  sha256?: string;
}
