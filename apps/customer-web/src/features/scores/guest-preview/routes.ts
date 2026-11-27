import { routing } from '@/i18n/routing';

export function guestPreviewLocation(token: string, locale: string): string {
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  return `${prefix}/preview/${encodeURIComponent(token)}`;
}
