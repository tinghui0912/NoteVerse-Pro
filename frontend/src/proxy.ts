import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'noteverse_session';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'noteverse_refresh';

const PROTECTED_PATH_PREFIXES = [
  '/upload',
  '/library',
  '/my-scores',
  '/settings',
  '/review',
  '/score',
  '/share',
];

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
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isPublicSharePath(pathname: string): boolean {
  return /^\/share\/[^/]+$/.test(pathname);
}

function getLoginPath(locale?: string): string {
  return locale && locale !== routing.defaultLocale ? `/${locale}/login` : '/login';
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, path } = stripLocale(pathname);
  const hasSession =
    request.cookies.has(AUTH_COOKIE_NAME) || request.cookies.has(REFRESH_COOKIE_NAME);

  if (isProtectedPath(path) && !isPublicSharePath(path) && !hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = getLoginPath(locale);
    loginUrl.search = '';
    loginUrl.searchParams.set('returnUrl', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    '/share/:path*',
    '/zh/share/:path*',
    '/en/share/:path*',
    '/invite/:path*',
    '/zh/invite/:path*',
    '/en/invite/:path*',
    '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
    '/',
  ],
};
