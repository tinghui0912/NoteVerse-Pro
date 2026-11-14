import type { GuestPreviewUpdateRequest } from '@/generated/api';
import { guestPreviewGet, scoreGuestPreviewSettingsGet, scoreGuestPreviewSettingsUpdate } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';
import { guestPageUrl, guestPlaybackUrl } from './native-resource-urls';

export const guestPreviewApi = {
  getSettings: (scoreId: string, signal?: AbortSignal) =>
    responseBody(scoreGuestPreviewSettingsGet({ ...customerTransport.authenticated, path: { score_id: scoreId }, signal })),
  updateSettings: (scoreId: string, input: GuestPreviewUpdateRequest) =>
    responseBody(scoreGuestPreviewSettingsUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  read: (token: string, signal?: AbortSignal) =>
    responseBody(guestPreviewGet({ ...customerTransport.public, path: { token: token }, signal })),
  pageUrl: guestPageUrl,
  playbackUrl: guestPlaybackUrl,
};
