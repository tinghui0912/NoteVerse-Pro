import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CUSTOMER_API_PREFIX } from '@/generated/browser-protocol';
import { customerRoutes } from '@/generated/customer-routes';
import { guestPageUrl, guestPlaybackUrl, realtimeEventsUrl, scorePlaybackUrl } from '@/lib/api/native-resource-urls';
import { scoreThumbnailUrl } from '@/lib/score-detail/thumbnail';
import { createRealtimeEventSource } from '@/lib/realtime/event-source';
import proxy from '@/proxy';
import config from '../../next.config';

vi.mock('@/i18n/routing', () => ({ routing: { locales: ['zh', 'en'], defaultLocale: 'en' } }));
vi.mock('next-intl/middleware', () => ({ default: () => () => new Response(null, { status: 200 }) }));
afterEach(() => vi.unstubAllGlobals());
const source = JSON.parse(fs.readFileSync('../../contracts/http/customer-browser-protocol.json', 'utf8'));
const spec = JSON.parse(fs.readFileSync('../../backend/docs/contracts/openapi/customer-api.json', 'utf8'));
const routes: Record<string, { method: string; url: string }> = {};
for (const [url, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods as Record<string, { operationId?: string }>)) {
    if (operation.operationId) routes[operation.operationId] = { method: method.toUpperCase(), url };
  }
}

it('shares canonical browser identity with Backend and Next proxy', () => {
  expect({ api_prefix: CUSTOMER_API_PREFIX, auth_cookie_name: AUTH_COOKIE_NAME, refresh_cookie_name: REFRESH_COOKIE_NAME, csrf_cookie_name: CSRF_COOKIE_NAME, csrf_header_name: CSRF_HEADER_NAME }).toEqual(source);
  for (const name of [source.auth_cookie_name, source.refresh_cookie_name]) {
    const response = proxy(new NextRequest('https://customer.test/en/library', { headers: { cookie: `${name}=session-value` } }));
    expect(response.status).toBe(200);
  }
  const anonymous = proxy(new NextRequest('https://customer.test/en/library'));
  expect(new URL(anonymous.headers.get('location')!).pathname).toBe('/auth/login');
});

it('uses the generated prefix and deployment origin for Next rewrite', async () => {
  expect(await config.rewrites?.()).toEqual([{
    source: `${source.api_prefix}/:path*`,
    destination: `${process.env.NEXT_BACKEND_ORIGIN}${source.api_prefix}/:path*`,
  }]);
});

it('projects native route method and URL metadata directly from Customer OpenAPI', () => {
  expect(customerRoutes).toEqual(routes);
});

const cases: Array<{ operation: keyof typeof customerRoutes; build: () => string | null; path: Record<string, string> }> = [
  { operation: 'scoreRevisionPlaybackStream', build: () => scorePlaybackUrl('score/a', 'rev?#'), path: { score_id: 'score/a', revision_id: 'rev?#' } },
  { operation: 'guestPreviewPlaybackStream', build: () => guestPlaybackUrl('bearer/a?#'), path: { token: 'bearer/a?#' } },
  { operation: 'guestPreviewPageView', build: () => guestPageUrl('bearer/a?#', 'page/a'), path: { token: 'bearer/a?#', asset_id: 'page/a' } },
  { operation: 'scoreRenderAssetView', build: () => scoreThumbnailUrl('page/a?#'), path: { render_asset_id: 'page/a?#' } },
  { operation: 'realtimeEventsStream', build: realtimeEventsUrl, path: {} },
];
it.each(cases)('builds a same-origin native $operation URL using its generated path contract', ({ operation, build, path }) => {
  const route = routes[operation];
  const expected = route.url.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(path[key]));
  expect(route.method).toBe('GET');
  expect(build()).toBe(expected);
  expect(new URL(build()!, 'https://customer.test').origin).toBe('https://customer.test');
});

it('keeps missing thumbnails empty and connects EventSource with credentials', () => {
  expect(scoreThumbnailUrl()).toBeNull();
  expect(scoreThumbnailUrl(null)).toBeNull();
  const constructed = vi.fn();
  class NativeEventSource {
    constructor(url: string, options?: EventSourceInit) { constructed(url, options); }
  }
  const send = vi.fn();
  vi.stubGlobal('EventSource', NativeEventSource);
  vi.stubGlobal('fetch', send);
  createRealtimeEventSource();
  expect(constructed).toHaveBeenCalledWith(routes.realtimeEventsStream.url, { withCredentials: true });
  expect(send).not.toHaveBeenCalled();
});
