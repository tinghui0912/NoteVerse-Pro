
'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { MarketingFooter } from '@/components/marketing/marketing-footer';

const pricingTiers = [
  {
    name: 'freeName',
    id: 'free',
    price: 0,
    priceDetails: 'month',
    features: ['freeFeature1', 'freeFeature2', 'freeFeature3'],
    cta: 'yourCurrentPlan',
    available: true,
  },
  {
    name: 'basicName',
    id: 'basic',
    price: 30,
    priceDetails: 'month',
    features: [
      'basicFeature1',
      'basicFeature2',
      'basicFeature3',
      'basicFeature4',
    ],
    cta: 'upgradePlan',
    popular: true,
    available: false,
  },
  {
    name: 'proName',
    id: 'pro',
    price: 99,
    priceDetails: 'month',
    features: [
      'proFeature1',
      'proFeature2',
      'proFeature3',
      'proFeature4',
    ],
    cta: 'upgradePlan',
    available: false,
  },
];


export default function SubscriptionsPage() {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const { isAuthenticated } = useAuth();
  const formatPrice = (price: number) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(price);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center">
          <h1 className="mb-4 text-4xl font-semibold tracking-tight text-gray-950 sm:text-5xl">{t('subscriptionsTitle')}</h1>
          <p className="text-lg text-gray-600">{t('subscriptionsSubtitle')}</p>
        </div>
      </div>
      
      <main className="grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          {isAuthenticated ? (
            <div className="mb-8 flex flex-col gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-orange-700">{t('signedInPlanStatus')}</p>
                <p className="mt-1 text-sm text-orange-900">{t('signedInPlanDesc')}</p>
              </div>
              <Button asChild variant="outline" className="border-orange-300 bg-white">
                <Link href="/settings/billing">
                  <ArrowLeft className="h-4 w-4" />
                  {t('backToBilling')}
                </Link>
              </Button>
            </div>
          ) : null}
          <div className="grid items-start gap-8 md:grid-cols-3">
            {pricingTiers.map((tier) => (
              <Card
                key={tier.name}
                className={cn(
                  'flex h-full flex-col rounded-lg bg-white shadow-sm transition-all',
                  tier.available ? 'border-2 border-orange-500' : 'border',
                  tier.popular ? 'transform md:scale-105' : ''
                )}
              >
                <CardHeader className="text-center pt-8 pb-4">
                  {tier.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <div className="inline-block rounded-full bg-orange-500 px-4 py-1 text-sm font-semibold text-white shadow-md">
                        {t('popular')}
                      </div>
                    </div>
                  )}
                  <CardTitle className="text-2xl font-bold">{t(tier.name as never)}</CardTitle>
                  <CardDescription className="mt-2">
                    <span className="text-4xl font-bold text-foreground">
                      {formatPrice(tier.price)}
                    </span>
                    <span className="text-muted-foreground">
                      {t(tier.priceDetails as never)}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-8">
                  <ul className="space-y-4">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        <CheckCircle className="mr-3 mt-1 h-5 w-5 shrink-0 text-green-500" />
                        <span className="text-muted-foreground">
                          {t(feature as never)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="p-6">
                  {tier.available ? (
                    <Button asChild size="lg" className="w-full bg-orange-500 text-white hover:bg-orange-600">
                      <Link href={isAuthenticated ? '/upload' : '/auth/login'}>{t('startForFree')}</Link>
                    </Button>
                  ) : (
                    <Button disabled size="lg" className="w-full">{t('comingSoon')}</Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
