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
    title: t('practiceTitle'),
    description: t('practiceDescription'),
  };
}

export default function PracticeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
