export type ImportJobState =
  | 'PENDING'
  | 'RUNNING'
  | 'PENDING_REVIEW'
  | 'CONFIRMED'
  | 'FAILURE';

export interface ImportJob {
  job_id: string;
  score_id?: string | null;
  state: ImportJobState;
  progress: number;
  title?: string;
  taxonomy_tags?: Array<{ category: string; code: string }>;
  thumbnail?: ImportArtifact | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
  public_code?: string | null;
  public_message?: string | null;
  original_images?: Array<ImportArtifact & { upload_id?: string; original_filename?: string }>;
}

export interface ImportArtifact {
  artifact_id: string;
  filename: string;
  page_number?: number;
  size?: number;
  mime_type?: string;
}

export interface ReviewArtifact {
  artifact_id: string;
  filename: string;
  mime_type?: string | null;
  size?: number | null;
  page_number?: number | null;
}

export interface ImportJobReview {
  job_id: string;
  state: 'PENDING_REVIEW' | 'CONFIRMED';
  score_id?: string | null;
  title?: string | null;
  taxonomy_tags: Array<{ category: string; code: string }>;
  musicxml: {
    artifact_id: string;
    content: string;
    mime_type?: string | null;
  } | null;
  original_images: ReviewArtifact[];
  created_at: string;
  updated_at: string;
}

export interface ReviewConfirmResult {
  score_id: string;
}

export type ReviewUpdateResult = ImportJobReview;
