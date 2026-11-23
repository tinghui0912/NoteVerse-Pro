'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function FreeAccessCard({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const t = useTranslations('plans');
  return (
    <Card className="border-orange-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>{t('freeName')}</CardTitle>
        <CardDescription>{t('freeDescription')}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild className="w-full bg-orange-500 text-white hover:bg-orange-600">
          <Link href={ctaHref}>
            {ctaLabel}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
