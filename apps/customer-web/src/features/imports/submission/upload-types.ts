type UploadFileStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface UploadableFile {
  file: File;
  clientRequestId: string;
  preview: string;
  uploadId?: string;
  status: UploadFileStatus;
  error?: string;
}
