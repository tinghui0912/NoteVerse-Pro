import type { UploadFileRead } from '@/generated/api';
import { fileDelete, filesUpload } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

async function uploadFile(file: File) {
  return responseBody(filesUpload({ ...customerTransport.authenticated, body: { file: file } }));
}

async function uploadFiles(
  files: File[],
  onProgress?: (current: number, total: number) => void
): Promise<UploadFileRead[]> {
  const results: UploadFileRead[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const response = await uploadFile(files[index]);
    if (response) results.push(response);
    onProgress?.(index + 1, files.length);
  }
  return results;
}

async function deleteFile(filename: string) {
  return responseComplete(fileDelete({ ...customerTransport.authenticated, path: { filename: filename } }));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const filesApi = { uploadFile, uploadFiles, deleteFile, triggerDownload };
