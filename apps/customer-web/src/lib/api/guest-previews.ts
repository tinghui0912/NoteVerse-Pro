import type { GuestPreviewUpdateRequest } from '@/generated/api';
import { guestPreviewGet, scoreGuestPreviewSettingsGet, scoreGuestPreviewSettingsUpdate } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';
import { guestPageUrl, guestPlaybackUrl } from './native-resource-urls';

export const guestPreviewApi = {
  getSettings: (scoreId: string, signal?: AbortSignal) =>
    responseData(scoreGuestPreviewSettingsGet({ ...customerTransport.authenticated, path: { score_id: scoreId }, signal })),
  updateSettings: (scoreId: string, input: GuestPreviewUpdateRequest) =>
    responseData(scoreGuestPreviewSettingsUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  read: (token: string, signal?: AbortSignal) =>
    responseData(guestPreviewGet({ ...customerTransport.public, path: { token: token }, signal })),
  pageUrl: guestPageUrl,
  playbackUrl: guestPlaybackUrl,
};
