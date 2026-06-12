import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import localFont from 'next/font/local';
import { cn } from '@/lib/utils';
import { ClientProviders } from '@/components/layout/client-providers';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });

  return {
    title: {
      default: t('siteTitle'),
      template: `%s | ${t('siteName')}`,
    },
    description: t('siteDescription'),
    keywords: t('siteKeywords'),
    authors: [{ name: 'NoteVerse Pro' }],
    openGraph: {
      type: 'website',
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      siteName: t('siteName'),
      title: t('siteTitle'),
      description: t('siteDescription'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('siteTitle'),
      description: t('siteDescription'),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

const fontBody = localFont({
  src: '../../fonts/inter.woff2',
  variable: '--font-body',
  display: 'swap',
});

const fontHeadline = localFont({
  src: '../../fonts/manrope.woff2',
  variable: '--font-headline',
  display: 'swap',
});

const fontCode = localFont({
  src: '../../fonts/source-code-pro.woff2',
  variable: '--font-code',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // 楠岃瘉 locale 鍚堟硶鎬?
  if (!routing.locales.includes(locale as never)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={cn(
          'font-body antialiased',
          fontBody.variable,
          fontHeadline.variable,
          fontCode.variable
        )}
      >
        <NextIntlClientProvider messages={messages}>
          <ClientProviders>{children}</ClientProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
