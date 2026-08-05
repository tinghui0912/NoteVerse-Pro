const DEFAULT_LOGIN_PATH = '/auth/login';
const LOCALE_PATTERN = /^\/(zh|en)(\/|$)/;

export function getSafeReturnUrl(value: string | null | undefined, fallback = '/upload'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  return value;
}

export function getLoginPath(pathname: string): string {
  const localeMatch = pathname.match(LOCALE_PATTERN);
  return localeMatch ? `/${localeMatch[1]}${DEFAULT_LOGIN_PATH}` : DEFAULT_LOGIN_PATH;
}

export function withReturnUrl(path: string, returnUrl: string | null | undefined): string {
  const safeReturnUrl = getSafeReturnUrl(returnUrl, '');
  if (!safeReturnUrl) return path;

  const params = new URLSearchParams({ returnUrl: safeReturnUrl });
  return `${path}?${params.toString()}`;
}

export function getLoginHrefForReturnUrl(returnUrl: string): string {
  return withReturnUrl(getLoginPath(returnUrl), returnUrl);
}

export function getCurrentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/';
  const { pathname, search } = window.location;
  return `${pathname}${search}`;
}

export function getCurrentLoginHref(): string {
  return getLoginHrefForReturnUrl(getCurrentPathWithSearch());
}
