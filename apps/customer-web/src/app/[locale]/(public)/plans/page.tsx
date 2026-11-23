'use client';

import { useTranslations } from 'next-intl';
import { FreeAccessCard } from '@/components/marketing/free-access-card';
import { MarketingFooter } from '@/components/marketing/marketing-footer';

export default function PlansPage() {
  const t = useTranslations('plans');
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="grow px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="mb-4 text-4xl font-semibold text-gray-950">{t('title')}</h1>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
          <div className="mx-auto mt-10 max-w-md text-left"><FreeAccessCard /></div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
