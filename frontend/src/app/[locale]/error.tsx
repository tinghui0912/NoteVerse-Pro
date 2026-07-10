'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={t('errorBoundaryTitle')}
      description={t('errorBoundaryDesc')}
      className="min-h-[70vh] px-4"
      primaryAction={
        <Button onClick={() => reset()} variant="default" size="lg">
          {t('tryAgain')}
        </Button>
      }
      secondaryAction={
        <Button asChild variant="outline" size="lg">
          <Link href="/">{t('returnHome')}</Link>
        </Button>
      }
    />
  );
}
