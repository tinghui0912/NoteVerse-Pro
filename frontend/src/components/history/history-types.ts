import type { TaskState } from '@/types/api';

export type HistoryTab = 'uploads' | 'shares';
export type HistoryView = 'list' | 'grid';
export type UploadStatus = 'completed' | 'pending-review' | 'in-progress' | 'queued' | 'failed';

export interface TaskHistoryItem {
  id: string;
  name: string;
  date: string;
  status: UploadStatus;
  thumbnail: string;
  thumbnailType?: string;
  thumbnailError?: boolean;
}

export interface ShareHistoryItem {
  id: number;
  name: string;
  sharedBy: string;
  date: string;
  thumbnail: string;
  taskId?: string;
  thumbnailType?: string;
  shareToken?: string;
  thumbnailError?: boolean;
}

export function mapTaskStateToStatus(state: TaskState): UploadStatus {
  switch (state) {
    case 'SUCCESS': return 'completed';
    case 'PENDING_REVIEW': return 'pending-review';
    case 'PROGRESS': return 'in-progress';
    case 'PENDING': return 'queued';
    case 'FAILURE': return 'failed';
    default: return 'queued';
  }
}

export function mapStatusToTaskState(status: string): TaskState | undefined {
  switch (status) {
    case 'completed': return 'SUCCESS';
    case 'pending-review': return 'PENDING_REVIEW';
    case 'in-progress': return 'PROGRESS';
    case 'queued': return 'PENDING';
    case 'failed': return 'FAILURE';
    default: return undefined;
  }
}

export function getTaskLink(item: TaskHistoryItem) {
  if (item.status === 'queued' || item.status === 'in-progress' || item.status === 'failed') {
    return `/upload?task_id=${item.id}`;
  }
  if (item.status === 'pending-review') {
    return `/review/${item.id}`;
  }
  return `/results/${item.id}?from=uploads`;
}
