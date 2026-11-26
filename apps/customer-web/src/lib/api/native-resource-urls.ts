import { customerRoutes } from '@/generated/customer-routes';
import type { GuestPreviewPageViewData, ScoreRenderAssetViewData, RealtimeEventsStreamData } from '@/generated/api';
import { customerTransport } from '@/lib/http/customer-browser-transport';

// Browser-native transports consume OpenAPI metadata and the official generated serializer.
export function guestPageUrl(token: string, assetId: string) {
  const request = {
    ...customerRoutes.guestPreviewPageView,
    path: { token, asset_id: assetId },
  } satisfies Pick<GuestPreviewPageViewData, 'url' | 'path'> & { method: 'GET' };
  return customerTransport.public.client.buildUrl({ ...request, baseUrl: '' });
}
export function renderAssetViewUrl(renderAssetId: string) {
  const request = {
    ...customerRoutes.scoreRenderAssetView,
    path: { render_asset_id: renderAssetId },
  } satisfies Pick<ScoreRenderAssetViewData, 'url' | 'path'> & { method: 'GET' };
  return customerTransport.authenticated.client.buildUrl({ ...request, baseUrl: '' });
}
export function realtimeEventsUrl() {
  const request = customerRoutes.realtimeEventsStream satisfies Pick<RealtimeEventsStreamData, 'url'> & { method: 'GET' };
  return customerTransport.authenticated.client.buildUrl({ ...request, baseUrl: '' });
}
