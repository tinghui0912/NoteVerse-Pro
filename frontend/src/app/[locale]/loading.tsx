'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function GlobalLoading() {
  const t = useTranslations('common');
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 w-full">
      <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
      <p className="text-gray-500 font-medium animate-pulse">{t('loading')}</p>
    </div>
  );
}
