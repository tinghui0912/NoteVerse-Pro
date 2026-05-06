'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
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
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="bg-red-50 p-6 rounded-full mb-6">
        <AlertTriangle className="w-12 h-12 text-red-500" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-4">
        {t('errorBoundaryTitle')}
      </h1>
      <p className="text-lg text-gray-600 mb-8 max-w-md mx-auto">
        {t('errorBoundaryDesc')}
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <Button onClick={() => reset()} variant="default" size="lg">
          {t('tryAgain')}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/">{t('returnHome')}</Link>
        </Button>
      </div>
    </div>
  );
}
