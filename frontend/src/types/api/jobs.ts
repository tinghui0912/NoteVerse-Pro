export type ProcessingJobState =
  | 'PENDING'
  | 'PROGRESS'
  | 'PENDING_REVIEW'
  | 'SUCCESS'
  | 'FAILURE';

export interface ProcessingJob {
  job_id: string;
  score_id?: string | null;
  state: ProcessingJobState;
  progress: number;
  current_step?: string;
  title?: string;
  taxonomy_tags?: Array<{ category: string; code: string }>;
  thumbnail_artifact_id?: string | null;
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

export interface ReviewArtifact {
  artifact_id: string;
  filename: string;
  mime_type?: string | null;
  size?: number | null;
  sha256?: string | null;
  page_number?: number | null;
}

export interface JobReview {
  job_id: string;
  state: 'PENDING_REVIEW' | 'SUCCESS';
  score_id?: string | null;
  title?: string | null;
  taxonomy_tags: Array<{ category: string; code: string }>;
  musicxml: {
    artifact_id: string;
    content: string;
    mime_type?: string | null;
    sha256?: string | null;
  } | null;
  original_images: ReviewArtifact[];
  created_at: string;
  updated_at: string;
}

export interface ReviewConfirmResult {
  score_id: string;
}

export type ReviewUpdateResult = JobReview;
