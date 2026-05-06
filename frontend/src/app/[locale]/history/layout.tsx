import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: t('historyTitle'),
    description: t('historyDescription'),
  };
}

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
