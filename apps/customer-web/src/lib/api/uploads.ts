import { uploadDelete, uploadsCreate } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

async function createUpload(file: File, clientRequestId: string) {
  return responseBody(uploadsCreate({ ...customerTransport.authenticated, body: { file, client_request_id: clientRequestId } }));
}

async function deleteUpload(uploadId: string) {
  return responseComplete(uploadDelete({ ...customerTransport.authenticated, path: { upload_id: uploadId } }));
}

export const uploadsApi = { createUpload, deleteUpload };
