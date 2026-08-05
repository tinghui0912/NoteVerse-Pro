'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw, Home } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { reportClientError } from '@/lib/observability';

export default function EditorError({
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
      route_group: 'workspace_score_editor',
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      icon={AlertCircle}
      title={t('errorBoundaryTitle')}
      description={t('errorBoundaryDesc')}
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
