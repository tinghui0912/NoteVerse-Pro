import type { GuestPreviewPageViewData, GuestPreviewPlaybackStreamData, ScoreRevisionPlaybackStreamData } from '@/generated/api';
import { customerTransport } from '@/lib/http/customer-browser-transport';

// Native resource URLs use the official serializer and generated route/input types.
// SDK operations expose no runtime route metadata; these typed templates serve native transports.
export function scorePlaybackUrl(scoreId: string, revisionId: string) {
  const request = {
    url: '/api/v1/scores/{score_id}/revisions/{revision_id}/playback',
    path: { score_id: scoreId, revision_id: revisionId },
  } satisfies Pick<ScoreRevisionPlaybackStreamData, 'url' | 'path'>;
  return customerTransport.authenticated.client.buildUrl({ ...request, baseUrl: '' });
}
export function guestPageUrl(token: string, assetId: string) {
  const request = {
    url: '/api/v1/guest-previews/{token}/render-assets/{asset_id}/view',
    path: { token, asset_id: assetId },
  } satisfies Pick<GuestPreviewPageViewData, 'url' | 'path'>;
  return customerTransport.public.client.buildUrl({ ...request, baseUrl: '' });
}
export function guestPlaybackUrl(token: string) {
  const request = {
    url: '/api/v1/guest-previews/{token}/playback',
    path: { token },
  } satisfies Pick<GuestPreviewPlaybackStreamData, 'url' | 'path'>;
  return customerTransport.public.client.buildUrl({ ...request, baseUrl: '' });
}
