'use client';

import { useTranslations } from 'next-intl';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { FreeAccessCard } from '@/components/marketing/free-access-card';
import { MarketingFooter } from '@/components/marketing/marketing-footer';

export default function PlansPage() {
  const t = useTranslations('plans');
  const { isAuthenticated } = useAuthentication();
  const ctaHref = isAuthenticated ? '/library' : '/auth/register';
  const ctaLabel = t(isAuthenticated ? 'openApp' : 'getStarted');
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="grow px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="mb-4 text-4xl font-semibold text-gray-950">{t('title')}</h1>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
          <div className="mx-auto mt-10 max-w-md text-left"><FreeAccessCard ctaHref={ctaHref} ctaLabel={ctaLabel} /></div>
        </div>
      </main>
      <MarketingFooter ctaHref={ctaHref} ctaLabel={ctaLabel} />
    </div>
  );
}
