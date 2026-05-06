import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

const namespaces = [
  'common',
  'home',
  'auth',
  'upload',
  'review',
  'editor',
  'results',
  'history',
  'share',
  'profile',
  'practice',
  'pricing',
  'help',
  'backend',
  'metadata',
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  const messages: Record<string, any> = {};
  for (const ns of namespaces) {
    messages[ns] = (await import(`../../messages/${locale}/${ns}.json`)).default;
  }

  return { locale, messages };
});
