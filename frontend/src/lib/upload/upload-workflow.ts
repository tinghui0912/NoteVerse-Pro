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
  upload_id?: string;
  original_filename?: string;
  sha256?: string;
}

export interface RestorableTaskData {
  upload_ids?: RestoredUploadInfo[];
}

export function getCompletedJobRoute(
  jobId: string,
  scoreId: string | null | undefined,
  state: string
) {
  return state === 'PENDING_REVIEW' ? `/review/${jobId}` : `/score/${scoreId}`;
}
