'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw, Home } from 'lucide-react';
import { Link } from '@/i18n/routing';

export default function EditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Specifically log editor errors
    console.error("Editor Error:", error);
  }, [error]);

  const description =
    process.env.NODE_ENV === 'development' && error.message
      ? error.message
      : t('errorBoundaryDesc');

  return (
    <ErrorState
      icon={AlertCircle}
      title={t('errorBoundaryTitle')}
      description={description}
      className="min-h-screen bg-gray-50 px-4"
      primaryAction={
        <Button onClick={() => reset()} className="min-w-40" size="lg">
          <RefreshCcw className="w-4 h-4" />
          {t('tryAgain')}
        </Button>
      }
      secondaryAction={
        <Button asChild variant="outline" className="min-w-40" size="lg">
          <Link href="/">
            <Home className="w-4 h-4" />
            {t('returnHome')}
          </Link>
        </Button>
      }
    />
  );
}
