'use client';

import { useTranslations } from 'next-intl';
import { ResourceLoading } from '@/components/loading/resource-loading';

interface PageLoadingProps {
  label?: string;
}

export function PageLoading({ label }: PageLoadingProps) {
  const common = useTranslations('common');
  return (
    <ResourceLoading
      label={label ?? common('loading')}
      minHeight="md"
      className="w-full"
    />
  );
}
