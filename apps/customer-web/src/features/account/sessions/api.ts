import { accountOtherSessionsRevoke, accountSessionRevoke, accountSessionsList } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const accountSessionsApi = {
  getSessions: (signal?: AbortSignal) =>
    responseBody(accountSessionsList({ ...customerTransport.authenticated, query: { limit: 100 }, signal })),
  revokeSession: (sessionId: string) =>
    responseComplete(accountSessionRevoke({ ...customerTransport.authenticated, path: { session_id: sessionId } })),
  revokeOtherSessions: () =>
    responseComplete(accountOtherSessionsRevoke({ ...customerTransport.authenticated })),
};
