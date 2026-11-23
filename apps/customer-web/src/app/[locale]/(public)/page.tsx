
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, UploadCloud, Edit, Share2, Music, Download } from 'lucide-react';
import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { placeholderImages } from '@/lib/placeholder-images';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { AnimatedSection } from '@/components/marketing/animated-section';
import { FreeAccessCard } from '@/components/marketing/free-access-card';
import { MarketingFooter } from '@/components/marketing/marketing-footer';

const features = [
  {
    icon: UploadCloud,
    title: 'feature1Title',
    description: 'feature1Desc',
    highlighted: false,
  },
  {
    icon: Music,
    title: 'feature2Title',
    description: 'feature2Desc',
    highlighted: true,
  },
  {
    icon: Edit,
    title: 'feature3Title',
    description: 'feature3Desc',
    highlighted: false,
  },
  {
    icon: Share2,
    title: 'feature4Title',
    description: 'feature4Desc',
    highlighted: false,
  },
];

export default function HomePage() {
  const t = useTranslations('home');
  const tPlans = useTranslations('plans');
  const { isAuthenticated } = useAuthentication();
  const ctaLink = isAuthenticated ? '/upload' : '/auth/register';
  const ctaLabel = isAuthenticated ? t('uploadScore') : tPlans('getStarted');
  const planCtaHref = isAuthenticated ? '/library' : '/auth/register';
  const planCtaLabel = tPlans(isAuthenticated ? 'openApp' : 'getStarted');

  return (
    <main className="bg-gray-50">
      {/* Hero Section */}
      <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-gray-50">
        <div className="absolute inset-0">
          <Image
            src={placeholderImages['main-bg'].url}
            alt="Musical background"
            fill
            priority
            className="h-full w-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-white/80"></div>
        </div>
        <div className="relative z-10 flex min-h-[calc(100vh-4rem)] items-center">
          <div className="mx-auto w-full max-w-7xl px-6 text-left text-gray-950">
            <h1 className="text-5xl font-semibold leading-tight tracking-tight lg:text-7xl">
              NOTEVERSE
              <br />
              <span className="text-orange-600">
                PRO
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-relaxed text-gray-600">
              {t('heroSubtitle')}
            </p>
             <div className="mt-8 flex flex-col items-start justify-start gap-4 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="group bg-orange-500 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  <Link href={ctaLink} className="flex items-center">
                    {ctaLabel}
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <AnimatedSection className="py-24 sm:py-32 bg-gray-50/80">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
            {t('howItWorksTitle')}
          </div>
          <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight mb-6">{t('howItWorksSubtitle')}</h2>
          <div className="relative mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: UploadCloud, title: 'step1Title', desc: 'step1Desc' },
              { icon: Music, title: 'step2Title', desc: 'step2Desc' },
              { icon: Download, title: 'step3Title', desc: 'step3Desc' },
            ].map((step, index) => (
              <div key={index} className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                  <step.icon className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t(step.title as never)}</h3>
                <p className="text-gray-600">{t(step.desc as never)}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>
      
      {/* Features Section */}
      <AnimatedSection id="features" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-16">
            <div className="lg:col-span-1 space-y-6">
              <div className="inline-flex items-center gap-2">
                <span className="w-3 h-0.5 bg-orange-500"></span>
                <p className="font-semibold text-orange-500">{t('featuresTitle')}</p>
              </div>
              <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight">{t('featuresSubtitle')}</h2>
              <p className="text-gray-600 text-lg">
                {t('featuresDesc')}
              </p>
            </div>
            <div className="lg:col-span-2 grid sm:grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <Card
                  key={index}
                  className={`rounded-lg p-6 ${
                    feature.highlighted
                      ? 'border-orange-200 bg-orange-50 text-gray-900 shadow-sm'
                      : 'bg-gray-50 text-gray-900'
                  }`}
                >
                  <div className="space-y-4">
                    <feature.icon className="h-8 w-8 text-orange-500" />
                    <h3 className="text-xl font-semibold">{t(feature.title as never)}</h3>
                    <p className="text-gray-600">
                      {t(feature.description as never)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection id="plans" className="bg-white py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="mb-6 text-4xl font-medium text-gray-900">{tPlans('title')}</h2>
            <p className="text-lg text-gray-600">{tPlans('subtitle')}</p>
          </div>
          <div className="mx-auto mt-12 max-w-md"><FreeAccessCard ctaHref={planCtaHref} ctaLabel={planCtaLabel} /></div>
        </div>
      </AnimatedSection>

      <MarketingFooter ctaHref={ctaLink} ctaLabel={ctaLabel} />
    </main>
  );
}
