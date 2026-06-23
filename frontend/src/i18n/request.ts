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
  'resultsShare',
  'errors',
  'history',
  'share',
  'profile',
  'practice',
  'pricing',
  'help',
  'backend',
  'metadata',
  'scoreStyles',
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as never)) {
    locale = routing.defaultLocale;
  }

  const messages: Record<string, unknown> = {};
  for (const ns of namespaces) {
    messages[ns] = (await import(`../../messages/${locale}/${ns}.json`)).default;
  }

  return { locale, messages };
});
