
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Footer } from '@/components/layout/footer';

const pricingTiers = [
  {
    name: 'freeName',
    id: 'free',
    price: '¥0',
    priceDetails: 'month',
    features: ['freeFeature1', 'freeFeature2', 'freeFeature3'],
    cta: 'yourCurrentPlan',
  },
  {
    name: 'basicName',
    id: 'basic',
    price: '¥30',
    priceDetails: 'month',
    features: [
      'basicFeature1',
      'basicFeature2',
      'basicFeature3',
      'basicFeature4',
    ],
    cta: 'upgradePlan',
    popular: true,
  },
  {
    name: 'proName',
    id: 'pro',
    price: '¥99',
    priceDetails: 'month',
    features: [
      'proFeature1',
      'proFeature2',
      'proFeature3',
      'proFeature4',
    ],
    cta: 'upgradePlan',
  },
];


export default function SubscriptionsPage() {
  const t = useTranslations('pricing');
  const tCommon = useTranslations('common');
  const { isAuthenticated } = useAuth();
  const [currentPlan, setCurrentPlan] = useState('free');

  const handleSelectPlan = (planId: string) => {
    if (isAuthenticated) {
      if (planId !== currentPlan) {
        setCurrentPlan(planId);
      }
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('subscriptionsTitle')}</h1>
          <p className="text-lg text-gray-300">{t('subscriptionsSubtitle')}</p>
        </div>
      </div>
      
      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <div className="grid items-start gap-8 md:grid-cols-3">
            {pricingTiers.map((tier) => (
              <Card
                key={tier.name}
                className={cn(
                  'bg-white rounded-2xl flex flex-col h-full shadow-lg transition-all',
                  currentPlan === tier.id ? 'border-2 border-orange-500' : 'border',
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
                  <CardTitle className="text-2xl font-bold">{t(tier.name as any)}</CardTitle>
                  <CardDescription className="mt-2">
                    <span className="text-4xl font-bold text-foreground">
                      {tier.price}
                    </span>
                    <span className="text-muted-foreground">
                      {t(tier.priceDetails as any)}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-8">
                  <ul className="space-y-4">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        <CheckCircle className="mr-3 mt-1 h-5 w-5 shrink-0 text-green-500" />
                        <span className="text-muted-foreground">
                          {t(feature as any)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="p-6">
                  {currentPlan === tier.id ? (
                    <Button disabled size="lg" className="w-full bg-gray-200 text-gray-500 rounded-full">{t('yourCurrentPlan')}</Button>
                  ) : (
                    <Button
                      onClick={() => handleSelectPlan(tier.id)}
                      size="lg"
                      className={cn("w-full rounded-full", tier.popular ? "bg-orange-500 hover:bg-orange-600 text-white font-semibold" : "bg-white text-orange-500 border border-orange-500 hover:bg-orange-50")}
                      asChild={!isAuthenticated}
                    >
                      {isAuthenticated ? (
                        <span>{t(tier.cta as any)}</span>
                      ) : (
                        <Link href="/login">{t('choosePlan')}</Link>
                      )}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
