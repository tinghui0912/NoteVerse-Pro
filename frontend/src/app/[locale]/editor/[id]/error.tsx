'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4 text-center">
      <div className="bg-white p-10 rounded-2xl shadow-xl max-w-lg w-full flex flex-col items-center">
        <div className="bg-red-100 p-4 rounded-full mb-6">
          <AlertCircle className="w-10 h-10 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          {t('errorBoundaryTitle')}
        </h1>
        <p className="text-gray-600 mb-8">
          {error.message || t('errorBoundaryDesc')}
        </p>
        <div className="flex flex-col w-full gap-3">
          <Button onClick={() => reset()} className="w-full flex items-center justify-center gap-2" size="lg">
            <RefreshCcw className="w-4 h-4" />
            {t('tryAgain')}
          </Button>
          <Button asChild variant="outline" className="w-full flex items-center justify-center gap-2" size="lg">
            <Link href="/">
              <Home className="w-4 h-4" />
              {t('returnHome')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
