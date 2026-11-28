import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { AUTH_COOKIE_NAME, SECURE_AUTH_COOKIE_NAME } from './generated/browser-protocol';

import {
  createNonce,
  customerSecurity,
  objectStorageOrigins,
  resourceCsp,
} from './lib/security/csp';

const intlMiddleware = createMiddleware(routing);
const PROTECTED_PATH_PREFIXES = ['/upload', '/library', '/settings', '/imports', '/score'];

function stripLocale(pathname: string): { locale?: string; path: string } {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (routing.locales.includes(firstSegment as (typeof routing.locales)[number])) {
    const stripped = `/${segments.slice(1).join('/')}`;
    return { locale: firstSegment, path: stripped === '/' ? '/' : stripped };
  }

  return { path: pathname };
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function getLoginPath(locale?: string): string {
  return locale && locale !== routing.defaultLocale ? `/${locale}/auth/login` : '/auth/login';
}

function routeRequest(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, path } = stripLocale(pathname);
  const hasSession =
    request.cookies.has(AUTH_COOKIE_NAME) || request.cookies.has(SECURE_AUTH_COOKIE_NAME);

  if (isProtectedPath(path) && !hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = getLoginPath(locale);
    loginUrl.search = '';
    loginUrl.searchParams.set('returnUrl', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const resource =
    /^\/(?:api|_next|images|fonts|soundfonts|model-assets|worklets)(?:\/|$)/.test(pathname) ||
    ['/favicon.ico', '/robots.txt', '/sitemap.xml'].includes(pathname);
  const document = !resource || request.headers.get('sec-fetch-dest') === 'document';
  const origins = objectStorageOrigins(process.env.CSP_OBJECT_STORAGE_ORIGINS);
  const nonce = createNonce();
  const security = customerSecurity({
    pathname,
    nonce,
    origins,
    development: process.env.NODE_ENV === 'development',
  });
  const headers = new Headers(request.headers);
  headers.delete('x-nonce');
  headers.delete('x-browser-policy');
  headers.delete('Content-Security-Policy');
  if (document) {
    headers.set('x-nonce', nonce);
    headers.set('x-browser-policy', security.policy);
    headers.set('Content-Security-Policy', security.headers['Content-Security-Policy']);
  }
  const forwarded = new NextRequest(request, { headers });
  const response = resource ? NextResponse.next({ request: { headers } }) : routeRequest(forwarded);
  for (const [name, value] of Object.entries(security.headers)) {
    if (document || name !== 'Content-Security-Policy') response.headers.set(name, value);
  }
  if (document) response.headers.set('Cache-Control', 'private, no-store');
  else response.headers.set('Content-Security-Policy', resourceCsp(origins));
  return response;
}

export const config = { matcher: ['/:path*'] };
