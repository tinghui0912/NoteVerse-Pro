'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { reportClientError } from '@/lib/observability';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    reportClientError(error, {
      area: 'route_error_boundary',
      route_group: 'locale',
      digest: error.digest,
    });
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
