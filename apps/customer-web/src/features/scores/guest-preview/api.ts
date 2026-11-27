import { guestPreviewPlaybackAccessGet, guestPreviewGet, scoreGuestPreviewSettingsGet, scoreGuestPreviewCredentialIssue, scoreGuestPreviewCredentialRevoke, scoreGuestPreviewCredentialRotate } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';
import { guestPageUrl } from '@/lib/api/native-resource-urls';

export const guestPreviewApi = {
  getSettings: (scoreId: string, signal?: AbortSignal) =>
    responseBody(scoreGuestPreviewSettingsGet({ ...customerTransport.authenticated, path: { score_id: scoreId }, signal })),
  issueCredential: (scoreId: string) =>
    responseBody(scoreGuestPreviewCredentialIssue({ ...customerTransport.authenticated, path: { score_id: scoreId } })),
  revokeCredential: (scoreId: string) =>
    responseBody(scoreGuestPreviewCredentialRevoke({ ...customerTransport.authenticated, path: { score_id: scoreId } })),
  rotateCredential: (scoreId: string) =>
    responseBody(scoreGuestPreviewCredentialRotate({ ...customerTransport.authenticated, path: { score_id: scoreId } })),
  read: (token: string, signal?: AbortSignal) =>
    responseBody(guestPreviewGet({ ...customerTransport.public, path: { token: token }, signal })),
  pageUrl: guestPageUrl,
  playbackAccess: (token: string, signal?: AbortSignal) => responseBody(guestPreviewPlaybackAccessGet({ ...customerTransport.public, path: { token }, signal })),
};
