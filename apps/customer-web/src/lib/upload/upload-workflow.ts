type UploadFileStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface UploadableFile {
  file: File;
  preview: string;
  uploadId?: string;
  status: UploadFileStatus;
  error?: string;
}

export function getCompletedJobRoute(
  jobId: string,
  scoreId: string | null | undefined,
  state: string
) {
  return state === 'READY_FOR_REVIEW' ? `/review/${jobId}` : `/score/${scoreId}`;
}
