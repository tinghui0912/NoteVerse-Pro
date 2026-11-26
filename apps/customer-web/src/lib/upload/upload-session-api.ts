import {
  uploadSessionsGet,
  uploadSessionPartUploadUrlCreate,
  uploadSessionPartsList,
  uploadSessionComplete,
} from '@/generated/api';
import {
  customerTransport,
  responseBody,
} from '@/lib/http/customer-browser-transport';

export const uploadSessionApi = {
  read: (sessionId: string, signal?: AbortSignal) =>
    responseBody(
      uploadSessionsGet({
        ...customerTransport.authenticated,
        path: { session_id: sessionId },
        signal,
      }),
    ),
  parts: (sessionId: string, signal?: AbortSignal) =>
    responseBody(
      uploadSessionPartsList({
        ...customerTransport.authenticated,
        path: { session_id: sessionId },
        signal,
      }),
    ),
  partTarget: (sessionId: string, partNumber: number, signal?: AbortSignal) =>
    responseBody(
      uploadSessionPartUploadUrlCreate({
        ...customerTransport.authenticated,
        path: { session_id: sessionId, part_number: partNumber },
        signal,
      }),
    ),
  complete: (sessionId: string, signal?: AbortSignal) =>
    responseBody(
      uploadSessionComplete({
        ...customerTransport.authenticated,
        path: { session_id: sessionId },
        signal,
      }),
    ),
};
