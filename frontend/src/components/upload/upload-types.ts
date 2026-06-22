export type UploadFileStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface UploadableFile {
  file: File;
  preview: string;
  fileId?: string;
  sha256?: string;
  status: UploadFileStatus;
  error?: string;
}

export interface RestoredUploadInfo {
  original_filename?: string;
  sha256?: string;
}

export interface RestorableTaskData {
  upload_ids?: RestoredUploadInfo[];
}

export function getCompletedScoreRoute(scoreId: string, state: string) {
  return state === 'PENDING_REVIEW' ? `/review/${scoreId}` : `/results/${scoreId}`;
}
