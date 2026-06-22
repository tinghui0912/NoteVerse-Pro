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
  difficulty?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  code?: string;
}
