import {
  uploadDelete,
  uploadRequestsCreate,
  uploadRequestCancel,
  uploadFinalize,
} from '@/generated/api';
import {
  customerTransport,
  responseBody,
  responseComplete,
} from '@/lib/http/customer-browser-transport';
import {
  uploadSession,
  type UploadSessionOptions,
} from '@/lib/upload/upload-session-client';

async function createUpload(
  file: File,
  clientRequestId: string,
  options: Pick<UploadSessionOptions, 'signal' | 'onProgress'> = {},
) {
  const contentType =
    file.type ||
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      bmp: 'image/bmp',
    }[file.name.split('.').pop()?.toLowerCase() ?? ''];
  const admission = await responseBody(
    uploadRequestsCreate({
      ...customerTransport.authenticated,
      body: {
        client_request_id: clientRequestId,
        filename: file.name,
        byte_size: file.size,
        content_type: contentType ?? 'application/octet-stream',
      },
      signal: options.signal,
    }),
  );
  if (admission.upload) return admission.upload;
  const sessionId = admission.upload_session.session_id;
  await uploadSession(sessionId, file, {
    ...options,
    cancel: () =>
      responseComplete(
        uploadRequestCancel({
          ...customerTransport.authenticated,
          path: { session_id: sessionId },
        }),
      ),
  });
  return responseBody(
    uploadFinalize({
      ...customerTransport.authenticated,
      path: { session_id: sessionId },
      signal: options.signal,
    }),
  );
}

async function deleteUpload(uploadId: string) {
  return responseComplete(
    uploadDelete({
      ...customerTransport.authenticated,
      path: { upload_id: uploadId },
    }),
  );
}
export const uploadsApi = { createUpload, deleteUpload };
