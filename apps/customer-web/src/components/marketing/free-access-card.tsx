'use client';

import { useTranslations } from 'next-intl';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function FreeAccessCard() {
  const t = useTranslations('plans');
  const { isAuthenticated } = useAuthentication();
  return (
    <Card className="border-orange-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>{t('freeName')}</CardTitle>
        <CardDescription>{t('freeDescription')}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild className="w-full bg-orange-500 text-white hover:bg-orange-600">
          <Link href={isAuthenticated ? '/library' : '/auth/register'}>
            {t(isAuthenticated ? 'openApp' : 'getStarted')}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
