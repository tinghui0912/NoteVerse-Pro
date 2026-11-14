import type { UploadRead } from '@/generated/api';
import { uploadDelete, uploadsCreate } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

async function createUpload(file: File) {
  return responseBody(uploadsCreate({ ...customerTransport.authenticated, body: { file: file } }));
}

async function createUploads(
  files: File[],
  onProgress?: (current: number, total: number) => void
): Promise<UploadRead[]> {
  const results: UploadRead[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const response = await createUpload(files[index]);
    if (response) results.push(response);
    onProgress?.(index + 1, files.length);
  }
  return results;
}

async function deleteUpload(uploadId: string) {
  return responseComplete(uploadDelete({ ...customerTransport.authenticated, path: { upload_id: uploadId } }));
}

export const uploadsApi = { createUpload, createUploads, deleteUpload };
