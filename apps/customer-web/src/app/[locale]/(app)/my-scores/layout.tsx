import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: t('myScoresTitle'),
    description: t('myScoresDescription'),
  };
}

export default function MyScoresLayout({ children }: { children: ReactNode }) {
  return children;
}
