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
    title: t('uploadTitle'),
    description: t('uploadDescription'),
  };
}

export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
