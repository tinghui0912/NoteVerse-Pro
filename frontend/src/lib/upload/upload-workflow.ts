export type UploadFileStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface UploadableFile {
  file: File;
  preview: string;
  fileId?: string;
  status: UploadFileStatus;
  error?: string;
}

export interface RestoredUploadInfo {
  upload_id?: string;
  original_filename?: string;
}

export interface RestorableTaskData {
  original_images?: RestoredUploadInfo[];
}

export function getCompletedJobRoute(
  jobId: string,
  scoreId: string | null | undefined,
  state: string
) {
  return state === 'PENDING_REVIEW' ? `/review/${jobId}` : `/score/${scoreId}`;
}
