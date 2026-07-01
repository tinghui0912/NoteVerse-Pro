export function getSafeReturnUrl(value: string | null | undefined, fallback = '/upload'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  return value;
}

export function withReturnUrl(path: string, returnUrl: string | null | undefined): string {
  const safeReturnUrl = getSafeReturnUrl(returnUrl, '');
  if (!safeReturnUrl) return path;

  const params = new URLSearchParams({ returnUrl: safeReturnUrl });
  return `${path}?${params.toString()}`;
}
