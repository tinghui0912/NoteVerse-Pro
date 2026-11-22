type UploadFileStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface UploadableFile {
  file: File;
  preview: string;
  uploadId?: string;
  status: UploadFileStatus;
  error?: string;
}
