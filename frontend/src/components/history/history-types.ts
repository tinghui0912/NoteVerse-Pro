import type { ProcessingJobState, ScoreState } from '@/types/api';

export type HistoryTab = 'uploads' | 'shares';
export type HistoryView = 'list' | 'grid';
export type UploadStatus = 'completed' | 'pending-review' | 'in-progress' | 'queued' | 'failed';

export interface TaskHistoryItem {
  id: string;
  selectionId: string;
  entity: 'score' | 'job';
  name: string;
  date: string;
  status: UploadStatus;
  thumbnail: string;
  thumbnailError?: boolean;
  headRevisionId?: string | null;
}

export interface ShareHistoryItem {
  id: number;
  selectionId: string;
  name: string;
  sharedBy: string;
  date: string;
  thumbnail: string;
  scoreId: string;
  available: boolean;
  thumbnailError?: boolean;
}

export function mapJobStateToStatus(state: ProcessingJobState): UploadStatus {
  switch (state) {
    case 'SUCCESS': return 'completed';
    case 'PENDING_REVIEW': return 'pending-review';
    case 'PROGRESS': return 'in-progress';
    case 'PENDING': return 'queued';
    case 'FAILURE': return 'failed';
  }
}

export function mapScoreStateToStatus(state: ScoreState): UploadStatus {
  return state === 'IN_REVIEW' ? 'pending-review' : 'completed';
}

export function getHistoryLink(item: TaskHistoryItem) {
  if (item.entity === 'job') return `/upload?job_id=${item.id}`;
  if (item.status === 'pending-review') return `/review/${item.id}`;
  return `/results/${item.id}?from=uploads`;
}
